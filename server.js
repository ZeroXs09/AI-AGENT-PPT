import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
import JSZip from 'jszip';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { planPresentationDeck } from './services/geminiAgent.js';
import { generatePptxFile } from './services/pptGenerator.js';
import { getStockPhotoUrl } from './services/imageService.js';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Serve static assets from public folder
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// ── Disk persistence: generated decks survive server restarts ──
const GENERATED_DIR = path.join(__dirname, 'generated');
if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

// Registry: fileId -> { fileId, filename, filePath, createdAt, title, slideCount, modelUsed }
const deckRegistry = new Map();

function loadRegistryFromDisk() {
    try {
        const metaFiles = fs.readdirSync(GENERATED_DIR).filter(f => f.endsWith('.json'));
        for (const f of metaFiles) {
            try {
                const meta = JSON.parse(fs.readFileSync(path.join(GENERATED_DIR, f), 'utf8'));
                if (meta.fileId && meta.filePath && fs.existsSync(meta.filePath)) {
                    deckRegistry.set(meta.fileId, meta);
                }
            } catch {
                // Skip corrupt metadata file
            }
        }
        console.log(`[FlyPtx] Restored ${deckRegistry.size} presentation(s) from disk`);
    } catch (err) {
        console.warn('[FlyPtx] Could not restore history from disk:', err.message);
    }
}
loadRegistryFromDisk();

// ── Simple per-IP rate limiter (no extra dependencies) ──
const RATE_LIMIT = 20;           // max requests
const RATE_WINDOW_MS = 60_000;   // per minute
const rateBuckets = new Map();

function rateLimit(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };

    if (now > bucket.resetAt) {
        bucket.count = 0;
        bucket.resetAt = now + RATE_WINDOW_MS;
    }
    bucket.count += 1;
    rateBuckets.set(ip, bucket);

    if (bucket.count > RATE_LIMIT) {
        const waitSec = Math.ceil((bucket.resetAt - now) / 1000);
        return res.status(429).json({ error: `Terlalu banyak permintaan. Coba lagi dalam ${waitSec} detik.` });
    }
    next();
}

// ── Allowed Gemini models (selectable from the UI) ──
const ALLOWED_MODELS = [
    'auto',
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
    'gemini-3.1-pro-preview',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
];

function isRecognizedGeminiKey(key) {
    const k = String(key || '').trim();
    return (k.startsWith('AIza') || k.startsWith('AQ.')) && k.length >= 25;
}

/**
 * 1. Health & Config Status Check
 */
app.get('/api/status', (req, res) => {
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    const hasGemini = Boolean(geminiKey);
    const geminiLooksValid = isRecognizedGeminiKey(geminiKey);
    const hasPexels = Boolean(process.env.PEXELS_API_KEY && process.env.PEXELS_API_KEY.trim() !== '');
    const hasPixabay = Boolean(process.env.PIXABAY_API_KEY && process.env.PIXABAY_API_KEY.trim() !== '');

    res.json({
        status: 'online',
        agent: 'FlyPtx AI Agent',
        engine: 'Node.js + Google Gemini + PptxGenJS',
        geminiConfigured: hasGemini,
        geminiLooksValid,
        pexelsConfigured: hasPexels,
        pixabayConfigured: hasPixabay,
        modelsSupported: ALLOWED_MODELS,
        themesSupported: ALLOWED_THEMES,
        tonesSupported: ALLOWED_TONES,
        defaultModel: 'auto'
    });
});

/**
 * Basic API key sanity check before persisting (length + charset, no spaces or control chars)
 */
function isValidApiKey(key) {
    if (typeof key !== 'string') return false;
    const k = key.trim();
    return k.length >= 8 && k.length <= 256 && !/\s/.test(k) && /^[\x21-\x7E]+$/.test(k);
}

/**
 * 2. Save / Update API Keys (Gemini, Pexels, Pixabay)
 */
app.post('/api/save-key', async (req, res) => {
    const { apiKey, geminiApiKey, pexelsApiKey, pixabayApiKey } = req.body || {};

    const gKey = (geminiApiKey || apiKey || '').trim();
    const pKey = (pexelsApiKey !== undefined && pexelsApiKey !== null) ? String(pexelsApiKey).trim() : '';
    const pxKey = (pixabayApiKey !== undefined && pixabayApiKey !== null) ? String(pixabayApiKey).trim() : '';

    const invalid = [];
    if (gKey && !isValidApiKey(gKey)) invalid.push('Gemini');
    if (pKey && !isValidApiKey(pKey)) invalid.push('Pexels');
    if (pxKey && !isValidApiKey(pxKey)) invalid.push('Pixabay');

    if (invalid.length > 0) {
        return res.status(400).json({
            success: false,
            error: `Format ${invalid.join(', ')} API key tidak valid (minimal 8 karakter tanpa spasi).`
        });
    }

    if (gKey) process.env.GEMINI_API_KEY = gKey;
    if (pKey) process.env.PEXELS_API_KEY = pKey;
    if (pxKey) process.env.PIXABAY_API_KEY = pxKey;

    try {
        const envPath = path.join(__dirname, '.env');
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }

        const updateEnvVar = (name, val) => {
            if (!val) return;
            const regex = new RegExp(`^${name}=.*$`, 'm');
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `${name}=${val}`);
            } else {
                envContent += `\n${name}=${val}`;
            }
        };

        updateEnvVar('GEMINI_API_KEY', gKey);
        updateEnvVar('PEXELS_API_KEY', pKey);
        updateEnvVar('PIXABAY_API_KEY', pxKey);

        fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
    } catch (err) {
        console.warn('Could not write to .env file:', err.message);
    }

    let warning = null;
    const activeGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (gKey && !isRecognizedGeminiKey(gKey)) {
        warning = 'API key disimpan, namun pastikan menggunakan key Google AI Studio (AIzaSy... atau AQ...).';
    }

    return res.json({
        success: true,
        message: warning || 'Pengaturan API key berhasil disimpan dan aktif',
        warning,
        geminiConfigured: Boolean(activeGeminiKey),
        geminiLooksValid: isRecognizedGeminiKey(activeGeminiKey),
        pexelsConfigured: Boolean(process.env.PEXELS_API_KEY),
        pixabayConfigured: Boolean(process.env.PIXABAY_API_KEY)
    });
});

/**
 * 3. Upload Document — ekstrak teks lokal (PDF, DOCX, DOC, PPTX, TXT, MD, CSV, HTML, JSON, RTF)
 *    lalu ringkas via Gemini jika API key valid, atau fallback ke perangkum dokumen lokal cerdas.
 */
const TEXT_LIKE_EXTS = ['.txt', '.md', '.csv', '.html', '.htm', '.json', '.xml', '.rtf'];
const SUPPORTED_DOC_EXTS = [...TEXT_LIKE_EXTS, '.pdf', '.docx', '.doc', '.pptx'];
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB (JSON body limit 25mb)

function decodeXmlEntities(str) {
    return String(str || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10) || 32))
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16) || 32));
}

function decodePdfLiteralString(raw) {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch !== '\\') {
            out += ch;
            continue;
        }
        i++;
        if (i >= raw.length) break;
        const next = raw[i];
        if (next === 'n') out += '\n';
        else if (next === 'r') out += '\r';
        else if (next === 't') out += '\t';
        else if (next === 'b') out += '\b';
        else if (next === 'f') out += '\f';
        else if (next === '(' || next === ')' || next === '\\') out += next;
        else if (next >= '0' && next <= '7') {
            let oct = next;
            if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
            if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
            out += String.fromCharCode(parseInt(oct, 8));
        } else {
            out += next;
        }
    }
    return out;
}

function decodePdfHexString(hex, cmap) {
    const clean = hex.replace(/\s+/g, '');
    if (!clean) return '';

    if (cmap && cmap.size > 0) {
        // Coba 4-hex (2 byte) terlebih dulu jika cocok, lalu 2-hex (1 byte)
        let mapped = '';
        let step = clean.length % 4 === 0 && Array.from(cmap.keys()).some(k => k.length === 4) ? 4 : 2;
        for (let i = 0; i < clean.length; i += step) {
            const code = clean.substring(i, i + step).toUpperCase();
            if (cmap.has(code)) {
                mapped += cmap.get(code);
            } else if (step === 4 && cmap.has(code.substring(0, 2))) {
                mapped += cmap.get(code.substring(0, 2));
                if (cmap.has(code.substring(2, 4))) mapped += cmap.get(code.substring(2, 4));
            } else {
                const cp = parseInt(code, 16);
                if (cp >= 32 && cp <= 126) mapped += String.fromCharCode(cp);
            }
        }
        if (mapped.trim()) return mapped;
    }

    // UTF-16BE BOM atau karakter 2-byte dengan byte tinggi 00
    if (clean.toUpperCase().startsWith('FEFF') || (clean.length % 4 === 0 && /^00[2-7][0-9A-Fa-f]/.test(clean))) {
        let out = '';
        const start = clean.toUpperCase().startsWith('FEFF') ? 4 : 0;
        for (let i = start; i + 3 < clean.length; i += 4) {
            const cp = parseInt(clean.substring(i, i + 4), 16);
            if (cp >= 32 && cp !== 0xFFFD) out += String.fromCodePoint(cp);
        }
        if (out.trim()) return out;
    }

    let out = '';
    for (let i = 0; i + 1 < clean.length; i += 2) {
        const cp = parseInt(clean.substring(i, i + 2), 16);
        if (cp >= 32 && cp <= 255) out += String.fromCharCode(cp);
    }
    return out;
}

function extractTextFromPdfBuffer(buffer) {
    const rawLatin1 = buffer.toString('latin1');
    const decodedStreams = [];

    // 1. Decompress semua stream PDF (FlateDecode maupun raw)
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match;
    while ((match = streamRegex.exec(rawLatin1)) !== null) {
        const streamBody = match[1];
        const streamBuf = Buffer.from(streamBody, 'latin1');
        let decompressed = null;
        try {
            decompressed = zlib.inflateSync(streamBuf).toString('latin1');
        } catch {
            try {
                decompressed = zlib.inflateRawSync(streamBuf).toString('latin1');
            } catch {
                if (streamBody.includes('BT') || streamBody.includes('Tj') || streamBody.includes('TJ')) {
                    decompressed = streamBody;
                }
            }
        }
        if (decompressed) decodedStreams.push(decompressed);
    }

    // 2. Bangun tabel ToUnicode CMap bila ada (beginbfchar / beginbfrange)
    const cmap = new Map();
    for (const s of decodedStreams) {
        if (!s.includes('beginbfchar') && !s.includes('beginbfrange')) continue;

        const bfCharBlocks = s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
        for (const block of bfCharBlocks) {
            const pairs = block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
            for (const p of pairs) {
                const src = p[1].toUpperCase();
                const dstHex = p[2];
                let dst = '';
                for (let i = 0; i + 3 < dstHex.length; i += 4) {
                    dst += String.fromCodePoint(parseInt(dstHex.substring(i, i + 4), 16));
                }
                if (dst) cmap.set(src, dst);
            }
        }

        const bfRangeBlocks = s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g);
        for (const block of bfRangeBlocks) {
            const ranges = block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
            for (const r of ranges) {
                const startCode = parseInt(r[1], 16);
                const endCode = Math.min(parseInt(r[2], 16), startCode + 512);
                let targetCode = parseInt(r[3], 16);
                const padLen = r[1].length;
                for (let c = startCode; c <= endCode; c++) {
                    const key = c.toString(16).toUpperCase().padStart(padLen, '0');
                    cmap.set(key, String.fromCodePoint(targetCode++));
                }
            }
        }
    }

    // 3. Ekstrak teks dari blok BT ... ET
    const chunks = [];
    const allSources = decodedStreams.length > 0 ? decodedStreams : [rawLatin1];
    for (const src of allSources) {
        const btBlocks = src.matchAll(/BT\b([\s\S]*?)\bET\b/g);
        for (const bt of btBlocks) {
            const block = bt[1];
            const tokenRegex = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\[(?:[\s\S]*?)\]\s*TJ|\b(?:Td|TD|T\*|'|")\b/g;
            let tok;
            let lineBuf = '';
            while ((tok = tokenRegex.exec(block)) !== null) {
                const t = tok[0];
                if (t === 'Td' || t === 'TD' || t === 'T*' || t === "'" || t === '"') {
                    if (lineBuf.trim()) {
                        chunks.push(lineBuf.trim());
                        lineBuf = '';
                    }
                } else if (t.startsWith('[')) {
                    const subTokens = t.matchAll(/\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g);
                    for (const st of subTokens) {
                        const sub = st[0];
                        if (sub.startsWith('(')) {
                            lineBuf += decodePdfLiteralString(sub.slice(1, -1));
                        } else if (sub.startsWith('<')) {
                            lineBuf += decodePdfHexString(sub.slice(1, -1), cmap);
                        } else {
                            const kern = parseFloat(sub);
                            if (kern < -120 && !lineBuf.endsWith(' ')) lineBuf += ' ';
                        }
                    }
                } else if (t.startsWith('(')) {
                    lineBuf += decodePdfLiteralString(t.slice(1, -1));
                } else if (t.startsWith('<')) {
                    lineBuf += decodePdfHexString(t.slice(1, -1), cmap);
                }
            }
            if (lineBuf.trim()) chunks.push(lineBuf.trim());
        }
    }

    let text = chunks
        .join('\n')
        .replace(/[^\S\r\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // 4. Fallback: cek metadata Title/Subject atau rangkaian karakter yang bisa dibaca
    if (text.replace(/[^A-Za-z0-9]/g, '').length < 20) {
        const fallbackParts = [];
        const metaMatches = rawLatin1.matchAll(/\/(?:Title|Subject|Keywords)\s*\(((?:\\.|[^\\()])+)\)/g);
        for (const m of metaMatches) {
            const decoded = decodePdfLiteralString(m[1]).trim();
            if (decoded.length > 2) fallbackParts.push(decoded);
        }
        if (fallbackParts.length > 0) {
            text = fallbackParts.join('\n');
        }
    }

    return text;
}

async function extractTextFromDocxBuffer(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
        throw new Error('File DOCX tidak memiliki word/document.xml yang valid.');
    }
    const xml = await docXmlFile.async('string');
    return decodeXmlEntities(
        xml
            .replace(/<\/w:p>/gi, '\n')
            .replace(/<w:br[^>]*\/?>/gi, '\n')
            .replace(/<w:tab[^>]*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, '')
    )
        .replace(/[^\S\r\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function extractTextFromPptxBuffer(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
        .sort((a, b) => {
            const na = parseInt(a.match(/\d+/)?.[0] || '0', 10);
            const nb = parseInt(b.match(/\d+/)?.[0] || '0', 10);
            return na - nb;
        });

    const slidesText = [];
    for (const slidePath of slideFiles) {
        const xml = await zip.file(slidePath).async('string');
        const text = decodeXmlEntities(
            xml
                .replace(/<\/a:p>/gi, '\n')
                .replace(/<[^>]+>/g, '')
        )
            .replace(/[^\S\r\n]+/g, ' ')
            .trim();
        if (text) slidesText.push(text);
    }
    return slidesText.join('\n\n');
}

function extractTextFromLegacyDocBuffer(buffer) {
    // Ekstrak segmen teks ASCII & UTF-16LE dari file binary .doc
    const noisePattern = /^(?:MSWordDoc|Word\.Document|Normal\.dot|Default Paragraph Font|Times New Roman|Calibri|Arial|Root Entry|CompObj|SummaryInformation|DocumentSummaryInformation|Microsoft Office Word)/i;
    const asciiRuns = buffer.toString('latin1').match(/[A-Za-z0-9À-ÿ.,:;!?()'"\-\/\s]{12,}/g) || [];
    const utf16Runs = buffer.toString('utf16le').match(/[A-Za-z0-9À-ÿ.,:;!?()'"\-\/\s]{12,}/g) || [];
    const combined = [...asciiRuns, ...utf16Runs]
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(s => s.length >= 12 && /[A-Za-z]{4,}/.test(s) && !noisePattern.test(s));
    return combined.join('\n');
}

function cleanPlainOrMarkupText(raw, ext) {
    let text = String(raw || '');
    if (ext === '.html' || ext === '.htm' || ext === '.xml') {
        text = decodeXmlEntities(
            text
                .replace(/<script[\s\S]*?<\/script>/gi, ' ')
                .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
                .replace(/<[^>]+>/g, ' ')
        );
    } else if (ext === '.rtf') {
        text = text
            .replace(/\\par\b/g, '\n')
            .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
            .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
            .replace(/[{}]/g, '');
    }
    return text.replace(/[^\S\r\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function buildLocalDocumentSummary(filename, textContent) {
    const cleanFilename = path.basename(filename || 'Dokumen', path.extname(filename || ''))
        .replace(/[_\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Materi Dokumen';

    const lines = String(textContent || '')
        .split(/\r?\n/)
        .map(l => l.replace(/\s+/g, ' ').trim())
        .filter(l => l.length >= 4);

    if (lines.length === 0) {
        return `Topik: ${cleanFilename}\nPoin kunci: Analisis konteks dan latar belakang ${cleanFilename}; Pembahasan struktur inti dan temuan utama; Rekomendasi langkah strategis dan kesimpulan\nData penting: tidak ada`;
    }

    // Kalimat/baris pertama yang representatif sebagai topik
    const firstHeading = lines.find(l => l.length >= 8 && l.length <= 140) || cleanFilename;
    const topic = firstHeading.toLowerCase().includes(cleanFilename.toLowerCase().substring(0, 10))
        ? firstHeading
        : `${cleanFilename}: ${firstHeading}`.substring(0, 140);

    // Ambil kalimat-kalimat bermakna sebagai poin kunci
    const sentences = String(textContent || '')
        .replace(/\r?\n+/g, '. ')
        .split(/(?<=[.!?])\s+|\.\s+/)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(s => s.length >= 25 && s.length <= 220 && /[A-Za-z]{4,}/.test(s));

    const keyPoints = (sentences.length >= 2 ? sentences.slice(0, 4) : lines.slice(0, 4))
        .map(s => s.replace(/^[•\-*\d.)\s]+/, '').replace(/;+/g, ',').trim())
        .filter(Boolean);

    while (keyPoints.length < 3) {
        if (keyPoints.length === 0) keyPoints.push(`Latar belakang dan pokok bahasan ${cleanFilename}`);
        else if (keyPoints.length === 1) keyPoints.push(`Analisis temuan utama dan implikasi strategis dari dokumen`);
        else keyPoints.push(`Rekomendasi tindak lanjut dan kesimpulan utama`);
    }

    // Cari kalimat yang memuat angka/persentase/data penting
    const dataSentences = sentences
        .filter(s => /\b\d+(?:[.,]\d+)?(?:\s*%|\s*juta|\s*miliar|\s*triliun|\s*ribu|\s*tahun|\s*orang|\s*unit|\s*Rp|\s*USD)?\b/i.test(s))
        .slice(0, 2)
        .map(s => s.substring(0, 140));

    const dataPenting = dataSentences.length > 0 ? dataSentences.join('; ') : 'tidak ada';

    return `Topik: ${topic}\nPoin kunci: ${keyPoints.slice(0, 4).join('; ')}\nData penting: ${dataPenting}`.substring(0, 1100);
}

function buildSummaryPrompt(filename) {
    return `Kamu adalah asisten pembuat presentasi FlyPtx. Ringkas isi dokumen "${filename}" menjadi bahan prompt presentasi yang siap dipakai.

Keluarkan TANPA pembukaan atau penutup, dalam format ini:
Topik: <satu kalimat topik presentasi yang spesifik>
Poin kunci: <3-5 poin penting dari dokumen, pisahkan dengan titik koma>
Data penting: <angka/statistik/fakta kunci dari dokumen; tulis "tidak ada" jika memang tidak ada>

Semua dalam Bahasa Indonesia, maksimal 120 kata total.`;
}

async function summarizeWithGemini(parts) {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) {
        throw new Error('Gemini API key belum diatur di .env');
    }
    const models = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash', 'gemini-flash-latest'];
    let lastError = null;
    for (const modelName of models) {
        try {
            const ai = new GoogleGenAI({ apiKey: key });
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout: ${modelName} tidak merespons`)), 25_000)
            );
            const generatePromise = ai.models.generateContent({
                model: modelName,
                contents: parts,
                config: { temperature: 0.3 },
            });
            const response = await Promise.race([generatePromise, timeoutPromise]);
            const text = response.text ? response.text.trim() : '';
            if (!text) throw new Error('Ringkasan kosong dari Gemini');
            return { summary: text, modelUsed: modelName };
        } catch (err) {
            console.error(`[FlyPtx] Summarize failed with ${modelName}:`, err.message);
            lastError = err;
            // Jika API key tidak valid, tidak perlu mencoba model lain
            if (/API_KEY_INVALID|API key not valid/i.test(err.message || '')) {
                break;
            }
        }
    }
    throw lastError || new Error('Gagal meringkas dokumen');
}

app.post('/api/upload-doc', rateLimit, async (req, res) => {
    try {
        const { filename = 'dokumen.txt', contentBase64 = '', mimeType = 'text/plain' } = req.body;

        if (!contentBase64) {
            return res.status(400).json({ error: 'Konten dokumen tidak boleh kosong.' });
        }

        const buffer = Buffer.from(contentBase64, 'base64');
        if (buffer.byteLength === 0) {
            return res.status(400).json({ error: 'Dokumen yang diunggah tampak kosong.' });
        }
        if (buffer.byteLength > MAX_UPLOAD_BYTES) {
            return res.status(400).json({ error: 'Ukuran dokumen maksimal 15 MB.' });
        }

        const ext = path.extname(filename || '').toLowerCase();
        const isPdf = ext === '.pdf' || mimeType === 'application/pdf';
        const isDocx = ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const isDoc = ext === '.doc' || mimeType === 'application/msword';
        const isPptx = ext === '.pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        const isTextLike = TEXT_LIKE_EXTS.includes(ext) || (mimeType || '').startsWith('text/') || mimeType === 'application/json';

        const docKind = isPdf ? 'pdf' : isDocx ? 'docx' : isDoc ? 'doc' : isPptx ? 'pptx' : isTextLike ? 'text' : 'unsupported';
        console.log(`[FlyPtx] Document uploaded: ${filename} (${(buffer.byteLength / 1024).toFixed(1)} KB, ${docKind})`);

        if (docKind === 'unsupported') {
            return res.status(400).json({
                error: `Format "${ext || mimeType || 'tidak dikenal'}" belum didukung. Gunakan PDF, DOCX, DOC, PPTX, TXT, MD, CSV, HTML, atau JSON.`,
                wordCount: 0
            });
        }

        // 1. Ekstrak teks lokal terlebih dulu agar selalu punya isi dokumen walaupun tanpa API key Gemini
        let extractedText = '';
        try {
            if (isPdf) {
                extractedText = extractTextFromPdfBuffer(buffer);
            } else if (isDocx) {
                extractedText = await extractTextFromDocxBuffer(buffer);
            } else if (isPptx) {
                extractedText = await extractTextFromPptxBuffer(buffer);
            } else if (isDoc) {
                extractedText = extractTextFromLegacyDocBuffer(buffer);
            } else {
                extractedText = cleanPlainOrMarkupText(buffer.toString('utf8'), ext);
            }
        } catch (extractErr) {
            console.warn(`[FlyPtx] Local extraction warning for ${filename}:`, extractErr.message);
        }

        const wordCount = extractedText ? extractedText.split(/\s+/).filter(Boolean).length : 0;
        const previewLines = extractedText
            ? extractedText.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 5)
            : [];

        if (!isPdf && !extractedText.trim()) {
            return res.status(400).json({ error: 'Dokumen yang diunggah tampak kosong atau tidak memiliki teks yang dapat dibaca.' });
        }

        // 2. Jika Gemini API key tersedia, coba ringkas via Gemini AI (dengan fallback aman bila API key tidak valid)
        let summaryResult = null;
        const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

        if (geminiKey) {
            try {
                if (isPdf) {
                    // Untuk PDF, selalu utamakan kirim PDF langsung (inlineData) ke Gemini
                    // agar font subset dari Word/Canva terbaca utuh tanpa pergeseran karakter
                    summaryResult = await summarizeWithGemini([
                        {
                            inlineData: {
                                data: contentBase64,
                                mimeType: 'application/pdf',
                            },
                        },
                        { text: buildSummaryPrompt(filename) },
                    ]);
                } else if (extractedText.trim()) {
                    summaryResult = await summarizeWithGemini([
                        { text: buildSummaryPrompt(filename) + '\n\nISI DOKUMEN:\n' + extractedText.substring(0, 12_000) },
                    ]);
                }
            } catch (aiErr) {
                console.warn('[FlyPtx] Gemini document summarization skipped/failed, using local smart summary:', aiErr.message);
            }
        }

        // 3. Gunakan hasil Gemini jika berhasil, atau hasil ekstraksi cerdas lokal jika Gemini gagal/key tidak valid
        const extractedPrompt = summaryResult
            ? summaryResult.summary.substring(0, 1200)
            : buildLocalDocumentSummary(filename, extractedText);

        return res.json({
            success: true,
            filename,
            extractedPrompt,
            wordCount,
            previewLines,
            summarizedBy: summaryResult ? summaryResult.modelUsed : 'ekstraktor-lokal'
        });

    } catch (err) {
        console.error('[FlyPtx] Upload error:', err.message);
        res.status(500).json({ error: 'Gagal memproses dokumen yang diunggah.', details: err.message });
    }
});

// ── Job-based generation with real progress ──
// POST returns a jobId immediately; the client polls /api/generation-status/:jobId
const generationJobs = new Map();
const JOB_TTL_MS = 30 * 60_000;

const ALLOWED_THEMES = ['dark', 'light', 'emerald', 'navy', 'burgundy', 'sunset'];
const ALLOWED_TONES = ['executive', 'startup', 'academic', 'casual'];

app.post('/api/generate-ppt', rateLimit, (req, res) => {
    const { prompt, slideCount = 6, language = 'id', theme = 'dark', model = 'auto', tone = 'executive' } = req.body;

    if (!prompt || String(prompt).trim() === '') {
        return res.status(400).json({ error: 'Topik presentasi wajib diisi.' });
    }

    const chosenModel = ALLOWED_MODELS.includes(model) ? model : 'auto';
    const chosenTheme = ALLOWED_THEMES.includes(theme) ? theme : 'dark';
    const chosenTone = ALLOWED_TONES.includes(tone) ? tone : 'executive';

    const jobId = crypto.randomUUID();
    generationJobs.set(jobId, {
        id: jobId,
        status: 'processing',
        step: 1,
        stepLabel: 'Menganalisis ide dan konteks',
        startedAt: Date.now()
    });

    console.log(`\n========================================`);
    console.log(`[FlyPtx Agent] New Generation Request (job ${jobId.substring(0, 8)}):`);
    console.log(`Prompt: "${String(prompt).trim()}" | Slides: ${slideCount} | Lang: ${language} | Theme: ${chosenTheme} | Tone: ${chosenTone} | Model: ${chosenModel}`);
    console.log(`========================================`);

    // Respond immediately; the heavy work runs in the background
    res.json({ jobId });

    runGeneration(generationJobs.get(jobId), {
        prompt: String(prompt).trim(),
        slideCount: parseInt(slideCount, 10) || 6,
        language: language || 'id',
        theme: chosenTheme,
        tone: chosenTone,
        model: chosenModel
    }).catch(err => {
        const job = generationJobs.get(jobId);
        if (job) {
            job.status = 'error';
            job.error = err.message || 'Gagal memproses presentasi';
        }
        console.error('[FlyPtx Agent] Generation failed:', err.message);
    });
});

/**
 * Persist a rendered PPTX to disk and register it (shared by generate & rebuild)
 */
function persistDeckFile(deckData, pptxBuffer) {
    const fileId = `deck_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const safeTitle = (deckData.deckTitle || 'Presentasi_FlyPtx')
        .replace(/[^a-zA-Z0-9_\-\s]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .substring(0, 40);
    const filename = `${safeTitle}.pptx`;
    const filePath = path.join(GENERATED_DIR, `${fileId}.pptx`);

    fs.writeFileSync(filePath, pptxBuffer);
    const meta = {
        fileId,
        filename,
        filePath,
        createdAt: Date.now(),
        title: deckData.deckTitle || safeTitle,
        slideCount: Array.isArray(deckData.slides) ? deckData.slides.length : 0,
        modelUsed: deckData.modelUsed || null,
        deck: deckData,
        // Thumbnail deck: foto slide pertama (kalau ada) untuk kartu "Presentasi saya"
        thumbnailUrl: Array.isArray(deckData.slides) && deckData.slides[0]
            ? (deckData.slides[0].imageUrl || null)
            : null
    };
    fs.writeFileSync(path.join(GENERATED_DIR, `${fileId}.json`), JSON.stringify(meta, null, 2));
    deckRegistry.set(fileId, meta);
    return meta;
}

async function runGeneration(job, params) {
    const setStep = (n, label) => {
        job.step = n;
        job.stepLabel = label;
    };

    // Steps 1-3: concept, narrative, visuals (Gemini + stock photos)
    const deckData = await planPresentationDeck({
        prompt: params.prompt,
        slideCount: params.slideCount,
        language: params.language,
        model: params.model,
        tone: params.tone,
        onProgress: setStep,
        photoOptions: {
            pexelsKey: process.env.PEXELS_API_KEY,
            pixabayKey: process.env.PIXABAY_API_KEY
        }
    });

    deckData.theme = params.theme;
    deckData.tone = params.tone;

    // Step 4: render the PowerPoint file
    setStep(4, 'Menyusun file PowerPoint');
    console.log(`[FlyPtx Agent] Building PPTX binary with PptxGenJS (Theme: ${params.theme})...`);
    const pptxBuffer = await generatePptxFile(deckData, params.theme);

    // Persist to disk so history survives restarts
    const meta = persistDeckFile(deckData, pptxBuffer);

    job.status = 'done';
    job.result = {
        fileId: meta.fileId,
        filename: meta.filename,
        downloadUrl: `/api/download/${meta.fileId}`,
        deck: deckData,
        notice: deckData.reasonNotice || null
    };

    console.log(`[FlyPtx Agent] Successfully prepared PPTX -> FileId: ${meta.fileId}`);
}

app.get('/api/generation-status/:jobId', (req, res) => {
    const { jobId } = req.params;

    // Opportunistic cleanup of stale jobs
    const now = Date.now();
    for (const [id, j] of generationJobs.entries()) {
        if (now - j.startedAt > JOB_TTL_MS) generationJobs.delete(id);
    }

    const job = generationJobs.get(jobId);
    if (!job) {
        return res.status(404).json({ error: 'Pekerjaan tidak ditemukan atau sudah kedaluwarsa.' });
    }

    if (job.status === 'done') {
        return res.json({ status: 'done', ...job.result });
    }
    if (job.status === 'error') {
        return res.json({ status: 'error', error: job.error });
    }
    return res.json({ status: 'processing', step: job.step, stepLabel: job.stepLabel });
});

/**
 * Regenerate ONE slide of an existing deck (user clicked "Buat ulang" on a slide card).
 * Returns a fresh single-slide JSON; the client swaps it into its deck copy.
 */
app.post('/api/regenerate-slide', rateLimit, async (req, res) => {
    try {
        const { topic, slide, slideNumber = 1, totalSlides = 1, language = 'id', model = 'auto' } = req.body;

        if (!slide || typeof slide !== 'object') {
            return res.status(400).json({ error: 'Data slide tidak valid.' });
        }
        if (!topic || String(topic).trim() === '') {
            return res.status(400).json({ error: 'Topik presentasi tidak ada.' });
        }

        const key = process.env.GEMINI_API_KEY;
        if (!key || key.trim() === '') {
            return res.status(400).json({ error: 'Gemini API key belum diatur di .env' });
        }

        const isEn = language === 'en';
        const langInstruction = isEn
            ? 'Produce all slide text, headings, point descriptions, and speaker notes in English.'
            : 'Produce all slide text, headings, point descriptions, and speaker notes in formal, authoritative Bahasa Indonesia.';

        const systemPrompt = `You are FlyPtx, an elite AI Agent & Executive Presentation Architect. Your task: regenerate ONE slide of an existing deck so it becomes sharper and more insightful.

${langInstruction}

RULES:
- Return the SAME slide schema as the original: layout, badge, title, subtitle, imageKeywords, then points OR cards OR keyMetric/metricLabel (matching the original structure), and speakerNotes.
- Keep or improve the layout type. Allowed layouts: title, split_image_right, split_image_left, card_grid_3, stat_highlight, conclusion.
- Point descriptions: 1-2 sentences, strictly 18-25 words max. Maximum 3 points.
- For "card_grid_3": exactly 3 cards, each description strictly 12-16 words.
- For "stat_highlight": keep keyMetric realistic; if the original metric was invented, replace it with a qualitative claim instead of a fake number.
- imageKeywords: 2-4 clean English search terms for stock photo lookup.
- Write fresh wording with a sharper angle than the original. Never invent fake statistics or sources.
Return STRICTLY valid JSON for the single slide object only — no markdown, no commentary.`;

        const userPrompt = `Deck topic: "${String(topic).trim()}"
This is slide ${parseInt(slideNumber, 10) || 1} of ${parseInt(totalSlides, 10) || 1}.
Original slide JSON:
${JSON.stringify(slide)}

Rewrite and improve this single slide.`;

        const normalizedRegenModel = model === 'gemini-2.5-flash-lite'
            ? 'gemini-3.5-flash-lite'
            : model === 'gemini-2.5-pro'
                ? 'gemini-3.1-pro-preview'
                : model;

        const candidateModels = normalizedRegenModel !== 'auto' && ALLOWED_MODELS.includes(normalizedRegenModel)
            ? [normalizedRegenModel, 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash'].filter((v, i, a) => a.indexOf(v) === i)
            : ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash', 'gemini-flash-latest'];

        let regenerated = null;
        let modelUsed = null;
        let lastError = null;

        for (const modelName of candidateModels) {
            try {
                console.log(`[FlyPtx Agent] Regenerating slide ${slideNumber} with ${modelName}...`);
                const ai = new GoogleGenAI({ apiKey: key });
                const timeoutMs = modelName.includes('lite') ? 30_000 : 25_000;
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Timeout: ${modelName} tidak merespons`)), timeoutMs)
                );
                const generatePromise = ai.models.generateContent({
                    model: modelName,
                    contents: `${systemPrompt}\n\n${userPrompt}`,
                    config: { responseMimeType: 'application/json', temperature: 0.7 },
                });
                const response = await Promise.race([generatePromise, timeoutPromise]);
                const textOutput = response.text ? response.text.trim() : '';
                if (!textOutput) throw new Error('Respons kosong dari Gemini');

                const jsonText = textOutput.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
                const newSlide = JSON.parse(jsonText);

                if (!newSlide || typeof newSlide !== 'object' || !newSlide.title || !newSlide.layout) {
                    throw new Error('Skema slide hasil regenerasi tidak valid');
                }
                newSlide.slideNumber = slideNumber;
                regenerated = newSlide;
                modelUsed = modelName;
                break;
            } catch (err) {
                console.error(`[FlyPtx Agent] Regenerate failed with ${modelName}:`, err.message);
                lastError = err;
            }
        }

        if (!regenerated) {
            return res.status(502).json({ error: 'Semua model gagal merancang ulang slide.', details: lastError?.message });
        }

        // Visual baru sesuai materi slide yang baru.
        // Gemini kadang mengembalikan imageKeywords sebagai array — normalisasi dulu.
        try {
            const rawKw = regenerated.imageKeywords || regenerated.imagePrompt;
            const searchKeywords = Array.isArray(rawKw)
                ? rawKw.join(' ')
                : (rawKw || `${regenerated.title} ${topic}`);
            regenerated.imageUrl = await getStockPhotoUrl(searchKeywords, {
                pexelsKey: process.env.PEXELS_API_KEY,
                pixabayKey: process.env.PIXABAY_API_KEY,
                slideIndex: Math.max(0, (parseInt(slideNumber, 10) || 1) - 1),
                topicPrompt: topic,
            });
        } catch (err) {
            console.warn('[FlyPtx Agent] Slide image enrichment failed:', err.message);
        }

        res.json({ success: true, slide: regenerated, modelUsed });
    } catch (err) {
        console.error('[FlyPtx Agent] Regenerate-slide error:', err.message);
        res.status(500).json({ error: 'Gagal merancang ulang slide.', details: err.message });
    }
});

/**
 * Generate ONE NEXT SLIDE continuing an existing presentation deck.
 * Prompts AI with the deck context (topic, previous slide titles, tone) to create
 * a logically flowing new slide and enriches it with a relevant stock photo.
 */
app.post('/api/generate-next-slide', rateLimit, async (req, res) => {
    try {
        const { topic, existingSlides = [], language = 'id', model = 'auto', tone = 'executive' } = req.body;

        if (!topic || String(topic).trim() === '') {
            return res.status(400).json({ error: 'Topik presentasi diperlukan untuk merancang slide baru.' });
        }

        const cleanTopic = String(topic).trim();
        const nextSlideNumber = Array.isArray(existingSlides) ? existingSlides.length + 1 : 1;
        const isEn = language === 'en';

        const TONE_INSTRUCTIONS = {
            executive: isEn
                ? 'Maintain a formal, authoritative, and strategic executive tone (McKinsey/BCG style).'
                : 'Gunakan gaya bahasa formal, otoritatif, dan strategis setingkat eksekutif (standar konsultan manajemen).',
            startup: isEn
                ? 'Write in an energetic, forward-looking startup pitch style with bold vision and growth metrics.'
                : 'Gunakan gaya bahasa pitch deck startup yang dinamis, visioner, persuasif, dan berorientasi pada pertumbuhan cepat.',
            academic: isEn
                ? 'Adopt a scholarly, research-oriented academic tone with precise terminology and objective analysis.'
                : 'Gunakan gaya bahasa ilmiah/akademik yang objektif, berbasis bukti, mendalam, dan menggunakan terminologi presisi.',
            casual: isEn
                ? 'Write in an engaging, approachable, and educational storytelling tone with relatable metaphors.'
                : 'Gunakan gaya bahasa santai, edukatif, komunikatif, mudah dipahami, dan mengalir seperti bercerita.'
        };
        const toneText = TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.executive;

        const langInstruction = isEn
            ? 'Produce all slide text, headings, point descriptions, and speaker notes in English.'
            : 'Produce all slide text, headings, point descriptions, and speaker notes in formal, authoritative Bahasa Indonesia.';

        const previousContext = Array.isArray(existingSlides) && existingSlides.length > 0
            ? existingSlides.map((s, idx) => `Slide ${s.slideNumber || idx + 1}: "${s.title || 'Untitled'}" (Layout: ${s.layout || 'standard'})`).join('\n')
            : '(Belum ada slide sebelumnya)';

        const systemPrompt = `You are FlyPtx, an elite AI Agent & Executive Presentation Architect combining McKinsey analytical depth and Gamma.ai visual elegance.
Your mission is to generate the SINGLE NEXT slide (Slide #${nextSlideNumber}) that logically continues the narrative flow of an existing presentation deck.

${langInstruction}
TONE REQUIREMENT:
${toneText}

CRITICAL SLIDE RULES:
- The new slide must logically extend the presentation: provide the next critical phase, strategic pillar, deep dive, solution mechanism, or measurable impact.
- NEVER produce shallow 3-word bullets, but NEVER write long essay paragraphs.
- STRICT LENGTH LIMIT: Each point description MUST be concise: exactly 1-2 sentences (strictly 18-25 words max).
- Maximum 2 or 3 structured points per slide.
- Allowed layout types: "split_image_right", "split_image_left", "card_grid_3", "stat_highlight", "conclusion". Choose the most appropriate layout for the content, avoiding repeating the layout of the immediately previous slide.
- For "card_grid_3": exactly 3 cards, each description strictly 12-16 words max.
- For "stat_highlight": realistic keyMetric, metricLabel, and 1-2 concise points.
- imageKeywords: 2-4 clean English keywords describing a specific, high-quality stock photo scene (e.g. "modern solar grid control room", "team executive meeting boardroom", "clean energy infrastructure").
- speakerNotes: 2-3 substantive sentences for the presenter to expand upon.

SCHEMA (Return STRICTLY valid JSON for the single slide object only):
{
  "layout": "split_image_right",
  "badge": "STRATEGI EKSEKUSI",
  "title": "Judul Slide Baru Yang Tajam",
  "subtitle": "Subjudul analitis atau ringkasan implikasi utama",
  "points": [
    { "headline": "Pilar Utama", "description": "Deskripsi terstruktur padat dan lugas 18 hingga 25 kata." },
    { "headline": "Faktor Pendukung", "description": "Penjelasan mekanisme pendukung operasional yang realistis." }
  ],
  "speakerNotes": "Catatan eksekutif untuk memandu jalannya presentasi.",
  "imageKeywords": "modern clean executive strategy planning"
}`;

        const userPrompt = `Deck Topic: "${cleanTopic}"
Existing Deck Structure:
${previousContext}

Generate Slide #${nextSlideNumber} continuing this presentation.`;

        const key = process.env.GEMINI_API_KEY;
        let generatedSlide = null;
        let modelUsed = null;

        if (key && key.trim() !== '') {
            const normalizedModel = model === 'gemini-2.5-flash-lite'
                ? 'gemini-3.5-flash-lite'
                : model === 'gemini-2.5-pro'
                    ? 'gemini-3.1-pro-preview'
                    : model;

            const candidateModels = normalizedModel !== 'auto' && ALLOWED_MODELS.includes(normalizedModel)
                ? [normalizedModel, 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash'].filter((v, i, a) => a.indexOf(v) === i)
                : ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash', 'gemini-flash-latest'];

            for (const modelName of candidateModels) {
                try {
                    console.log(`[FlyPtx Agent] Generating next slide #${nextSlideNumber} with ${modelName}...`);
                    const ai = new GoogleGenAI({ apiKey: key });
                    const timeoutMs = modelName.includes('lite') ? 25_000 : 20_000;
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`Timeout: ${modelName} tidak merespons`)), timeoutMs)
                    );
                    const generatePromise = ai.models.generateContent({
                        model: modelName,
                        contents: `${systemPrompt}\n\n${userPrompt}`,
                        config: { responseMimeType: 'application/json', temperature: 0.7 },
                    });
                    const response = await Promise.race([generatePromise, timeoutPromise]);
                    const textOutput = response.text ? response.text.trim() : '';
                    if (!textOutput) throw new Error('Respons kosong dari Gemini');

                    const jsonText = textOutput.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
                    const parsed = JSON.parse(jsonText);

                    if (parsed && typeof parsed === 'object' && parsed.title) {
                        generatedSlide = parsed;
                        modelUsed = modelName;
                        break;
                    }
                } catch (err) {
                    console.warn(`[FlyPtx Agent] Generate next slide failed with ${modelName}:`, err.message);
                }
            }
        }

        // Fallback jika API key tidak ada atau semua model timeout/gagal
        if (!generatedSlide) {
            console.log(`[FlyPtx Agent] Creating structured fallback slide for #${nextSlideNumber}...`);
            generatedSlide = {
                layout: (nextSlideNumber % 2 === 0) ? 'split_image_right' : 'split_image_left',
                badge: isEn ? `PHASE ${nextSlideNumber}` : `FASE ${nextSlideNumber}`,
                title: isEn ? `Strategic Advancement for ${cleanTopic}` : `Akselerasi Strategis: ${cleanTopic}`,
                subtitle: isEn ? 'Actionable framework to scale operations and maximize outcomes' : 'Kerangka kerja terarah untuk memperkuat dampak dan keberlanjutan inisiatif',
                points: isEn ? [
                    { headline: 'Operational Synergy', description: 'Align core workflows and optimize resource allocation across all functional units.' },
                    { headline: 'Measurable Milestones', description: 'Track structured KPIs quarterly to ensure consistent compliance and sustainable value creation.' }
                ] : [
                    { headline: 'Sinergi Operasional', description: 'Penyelarasan alur kerja utama dan optimalisasi alokasi sumber daya lintas unit strategis.' },
                    { headline: 'Tolok Ukur Terukur', description: 'Pemantauan indikator kinerja secara berkala guna memastikan target tercapai konsisten.' }
                ],
                speakerNotes: isEn
                    ? `Emphasize the operational synergy and execution cadence for slide ${nextSlideNumber}.`
                    : `Tekankan pentingnya sinergi operasional dan disiplin eksekusi pada slide ke-${nextSlideNumber}.`,
                imageKeywords: `${cleanTopic} corporate strategy execution modern teamwork`
            };
            modelUsed = 'FlyPtx Architectural Fallback';
        }

        generatedSlide.slideNumber = nextSlideNumber;
        if (!generatedSlide.layout) generatedSlide.layout = 'split_image_right';
        if (!Array.isArray(generatedSlide.points)) generatedSlide.points = generatedSlide.points || [];
        if (!Array.isArray(generatedSlide.cards)) generatedSlide.cards = generatedSlide.cards || [];
        if (!Array.isArray(generatedSlide.bullets)) generatedSlide.bullets = [];

        // Ambil foto stok berkualitas tinggi yang relevan secara otomatis
        try {
            const rawKw = generatedSlide.imageKeywords || generatedSlide.imagePrompt;
            const searchKeywords = Array.isArray(rawKw)
                ? rawKw.join(' ')
                : (rawKw || `${generatedSlide.title} ${cleanTopic}`);
            
            console.log(`[FlyPtx Agent] Fetching stock photo for slide #${nextSlideNumber} with query: "${searchKeywords}"`);
            generatedSlide.imageUrl = await getStockPhotoUrl(searchKeywords, {
                pexelsKey: process.env.PEXELS_API_KEY,
                pixabayKey: process.env.PIXABAY_API_KEY,
                slideIndex: Math.max(0, nextSlideNumber - 1),
                topicPrompt: cleanTopic,
            });
        } catch (imgErr) {
            console.warn('[FlyPtx Agent] Photo enrichment for new slide failed:', imgErr.message);
            generatedSlide.imageUrl = 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80';
        }

        res.json({ success: true, slide: generatedSlide, modelUsed });
    } catch (err) {
        console.error('[FlyPtx Agent] Generate-next-slide error:', err.message);
        res.status(500).json({ error: 'Gagal merancang slide baru.', details: err.message });
    }
});

/**
 * Rebuild the PPTX from the client's edited deck copy (after slide edits / regeneration).
 */
app.post('/api/rebuild-pptx', rateLimit, async (req, res) => {
    try {
        const { deck, theme = 'dark' } = req.body;

        if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
            return res.status(400).json({ error: 'Data deck tidak valid.' });
        }

        const chosenTheme = ALLOWED_THEMES.includes(theme) ? theme : (deck.theme || 'dark');
        const deckData = { ...deck, theme: chosenTheme };
        console.log(`[FlyPtx Agent] Rebuilding PPTX from edited deck (${deckData.slides.length} slides, theme ${deckData.theme})...`);

        const pptxBuffer = await generatePptxFile(deckData, deckData.theme);
        const meta = persistDeckFile(deckData, pptxBuffer);

        res.json({
            success: true,
            fileId: meta.fileId,
            filename: meta.filename,
            downloadUrl: `/api/download/${meta.fileId}`
        });
    } catch (err) {
        console.error('[FlyPtx Agent] Rebuild failed:', err.message);
        res.status(500).json({ error: 'Gagal menyusun ulang file PowerPoint.', details: err.message });
    }
});

/**
 * 4c. Get presentation slide deck metadata & slides for preview/editing
 */
app.get('/api/deck/:fileId', (req, res) => {
    const { fileId } = req.params;
    const meta = deckRegistry.get(fileId);

    if (!meta) {
        return res.status(404).json({ error: 'Presentasi tidak ditemukan.' });
    }

    if (!meta.deck) {
        return res.status(404).json({ error: 'Data struktur slide tidak tersimpan untuk presentasi ini.', canDownload: true });
    }

    res.json({
        success: true,
        fileId: meta.fileId,
        filename: meta.filename,
        downloadUrl: `/api/download/${meta.fileId}`,
        deck: meta.deck
    });
});

/**
 * 5. Download Generated PPTX File (streams from disk)
 */
app.get('/api/download/:fileId', (req, res) => {
    const { fileId } = req.params;
    const meta = deckRegistry.get(fileId);

    if (!meta || !fs.existsSync(meta.filePath)) {
        return res.status(404).send('File presentasi tidak ditemukan atau sudah dihapus dari disk.');
    }

    const buffer = fs.readFileSync(meta.filePath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.filename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
});

/**
 * 5b. Delete a generated presentation (removes files from disk + registry)
 */
app.delete('/api/delete-presentation/:fileId', (req, res) => {
    const { fileId } = req.params;
    const meta = deckRegistry.get(fileId);

    if (!meta) {
        return res.status(404).json({ error: 'Presentasi tidak ditemukan.' });
    }

    try {
        fs.rmSync(meta.filePath, { force: true });
    } catch (err) {
        console.warn('[FlyPtx] Could not remove pptx file:', err.message);
    }
    try {
        fs.rmSync(path.join(GENERATED_DIR, `${fileId}.json`), { force: true });
    } catch (err) {
        console.warn('[FlyPtx] Could not remove metadata file:', err.message);
    }
    deckRegistry.delete(fileId);

    console.log(`[FlyPtx] Presentation deleted: ${meta.filename}`);
    res.json({ success: true });
});

/**
 * 6. List recently generated presentations (from disk-backed registry)
 */
app.get('/api/recent-presentations', (req, res) => {
    const recent = [];
    for (const [id, meta] of deckRegistry.entries()) {
        recent.push({
            fileId: id,
            filename: meta.filename,
            title: meta.title || meta.filename,
            thumbnailUrl: meta.thumbnailUrl || null,
            downloadUrl: `/api/download/${id}`,
            createdAt: meta.createdAt
        });
    }
    recent.sort((a, b) => b.createdAt - a.createdAt);
    res.json({ presentations: recent.slice(0, 20) });
});

/**
 * 7. Catch-all fallback to index.html
 */
app.use((req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('FlyPtx Node.js Server is running! Place your index.html in the public/ folder.');
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`FlyPtx Node.js AI Agent Server is live!`);
    console.log(`Local URL: http://localhost:${PORT}`);
    console.log(`History folder: ${GENERATED_DIR}`);
    console.log(`======================================================\n`);
});
