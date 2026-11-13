import { GoogleGenAI } from '@google/genai';
import { getStockPhotoUrl } from './imageService.js';

/**
 * Model IDs valid di Google Gemini API yang dipakai FlyPtx.
 * Daftar dikoreksi dari respons API sungguhan (Nov 2026):
 * - gemini-3.5-flash-lite: model Flash-Lite cepat & stabil (pengganti gemini-2.5-flash-lite yang 404)
 * - gemini-3.8-flash: model Flash terkini
 * - gemini-3.1-pro-preview: model Pro terkini (pengganti gemini-2.5-pro yang 404)
 * - gemini-flash-lite-latest / gemini-flash-latest: alias resmi fallback
 */
export const MODEL_OPTIONS = [
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (Cepat)' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Stabil)' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite terbaru' },
    { id: 'gemini-flash-latest', label: 'Gemini Flash terbaru' },
];

const LEGACY_MODEL_MAP = {
    'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
    'gemini-2.5-pro': 'gemini-3.1-pro-preview',
    'gemini-2.5-flash': 'gemini-3.5-flash',
};

const FALLBACK_CHAIN = [
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
    'gemini-flash-latest',
];

/**
 * AI Agent for Presentation Structuring using Gemini Flash
 * Generates deep knowledge content & professional stock photo visual prompts (Gamma.ai quality).
 */
export async function planPresentationDeck({ prompt, slideCount = 6, language = 'id', apiKey = null, model = 'auto', onProgress = () => {}, photoOptions = {}, tone = 'executive' }) {
    const activeApiKey = apiKey || process.env.GEMINI_API_KEY;
    const report = (n, label) => { try { onProgress(n, label); } catch { /* progress is best-effort */ } };

    if (!activeApiKey || activeApiKey.trim() === '') {
        console.warn('[GeminiAgent] No GEMINI_API_KEY detected. Returning deep structured fallback deck.');
        return await generateFallbackDeck(prompt, slideCount, language, 'API key belum diatur di .env', photoOptions, tone);
    }

    const isEn = language === 'en';
    const langInstructions = isEn
        ? 'Produce all slide text, headings, point descriptions, and speaker notes in English.'
        : 'Produce all slide text, headings, point descriptions, and speaker notes in formal, authoritative Bahasa Indonesia.';

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

    const systemPrompt = `You are FlyPtx, an elite AI Agent & Presentation Architect combining high analytical depth and the visual elegance of Gamma.ai.
Your mission is to transform user prompts into comprehensive, high-impact, deeply knowledgeable presentation slides.

${langInstructions}
TONE OF VOICE REQUIREMENT:
${toneText}

CRITICAL CONTENT DEPTH & POWERPOINT CANVAS FIT RULES:
- NEVER produce shallow, generic 3-word bullet points, but ALSO NEVER write long essay paragraphs.
- STRICT LENGTH LIMIT: Slides in PowerPoint have fixed boundaries. To prevent text from overflowing outside the slide canvas, each point description MUST be concise and impactful: exactly 1 to 2 sentences (strictly 18-25 words maximum).
- Maximum 2 or 3 structured points per slide.
- For "card_grid_3": Exactly 3 cards. Each card's description must be strictly 12-16 words maximum.
- For "stat_highlight": 1 prominent metric (e.g. "5.4 Juta Jiwa", "20-25%", "Rp 73.9 T"), 1 short label, and 1-2 concise takeaway points (max 15 words each).
- For "imageKeywords": Write 2 to 4 clean English search terms for stock photo lookup on Pexels / Pixabay (e.g. "amazon rainforest canopy", "tropical river boat", "forest conservation ranger"). IMPORTANT: Every slide MUST have DIFFERENT and DISTINCT English imageKeywords describing a different visual scene — NEVER repeat the same imageKeywords across slides.

LAYOUT TYPES TO USE:
1. "title": Hero cover slide with title, subtitle, badge, and hero visual keywords.
2. "split_image_right": Deep analytical narrative with 2-3 structured points on the left, paired with an evocative photo on the right.
3. "split_image_left": Evocative photo on the left, structured analysis and strategic points on the right.
4. "card_grid_3": 3 distinct comparative or pillar cards side by side, each with a badge, title, and detailed explanation.
5. "stat_highlight": A massive quantitative metric, metric label, concise analytical card, and supporting visual.
6. "conclusion": Executive roadmap or 3 action directives summarizing key takeaways.

Return STRICTLY valid JSON with no markdown formatting and no extra commentary.

SCHEMA SPECIFICATION:
{
  "deckTitle": "Main presentation title",
  "deckSubtitle": "Substantive executive subtitle or thesis statement",
  "category": "Domain Category (e.g. Kesehatan, Kebijakan Publik, Teknologi, Bisnis)",
  "theme": "forest_green",
  "slides": [
    {
      "slideNumber": 1,
      "layout": "title",
      "badge": "1-2 WORDS BADGE",
      "title": "Compelling Slide Title",
      "subtitle": "Substantive thesis statement (max 15 words)",
      "imageKeywords": "2 to 4 clean English search keywords for stock photo, e.g. 'doctor patient healthcare'",
      "points": [
        {
          "headline": "Nama Konsep / Analisis",
          "description": "Penjelasan berbobot dan ringkas (18-25 kata) dengan data atau mekanisme konkret."
        }
      ],
      "bullets": [
        "**Nama Konsep**: Penjelasan berbobot dan ringkas (18-25 kata)..."
      ],
      "cards": [
        { "badge": "PILAR 1", "title": "Judul Pilar", "description": "Analisis ringkas (12-16 kata)." },
        { "badge": "PILAR 2", "title": "Judul Pilar", "description": "Analisis ringkas (12-16 kata)." },
        { "badge": "PILAR 3", "title": "Judul Pilar", "description": "Analisis ringkas (12-16 kata)." }
      ],
      "keyMetric": "5.4 Juta",
      "metricLabel": "Label metrik terukur",
      "speakerNotes": "Catatan singkat 1-2 kalimat untuk presenter."
    }
  ]
}`;

    const userPrompt = `Topic / Idea: "${prompt}"
Requested slide count: exactly ${slideCount} slides.
MANDATORY TONE OF VOICE: ${tone.toUpperCase()}
Tone Directive: ${toneText}
CRITICAL INSTRUCTION: Tailor all slide badges, titles, subtitles, point headlines, descriptions, and speaker notes to strongly embody the ${tone.toUpperCase()} style.
Create a deeply researched, comprehensive, Gamma.ai-style presentation deck formatted strictly according to the schema.`;

    // Normalisasi bila klien masih mengirim ID model lama (2.5 -> 3.5/3.1)
    const normalizedModel = LEGACY_MODEL_MAP[model] || model;
    const chosen = MODEL_OPTIONS.find(m => m.id === normalizedModel);
    const candidateModels = chosen
        ? [chosen.id, ...FALLBACK_CHAIN.filter(id => id !== chosen.id)]
        : FALLBACK_CHAIN;
    let lastError = null;

    report(1, 'Menganalisis ide dan konteks');

    for (const modelName of candidateModels) {
        try {
            const optionEntry = MODEL_OPTIONS.find(m => m.id === modelName);
            const modelLabel = optionEntry ? optionEntry.label : modelName;
            console.log(`[GeminiAgent] Attempting generation with model: ${modelName}...`);
            report(2, `${modelLabel} merumuskan narasi dan slide`);

            const ai = new GoogleGenAI({
                apiKey: activeApiKey,
                httpOptions: { timeout: 20_000 }
            });

            // Batasi waktu tunggu per model agar bila 1 model sedang penuh (503) langsung pindah ke fallback yang cepat
            const timeoutMs = modelName.includes('lite') ? 16_000 : 20_000;
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout: Model ${modelName} sedang sibuk, beralih ke model cadangan`)), timeoutMs)
            );

            const generatePromise = ai.models.generateContent({
                model: modelName,
                contents: `${systemPrompt}\n\n${userPrompt}`,
                config: {
                    responseMimeType: 'application/json',
                    temperature: 0.65,
                }
            });

            const response = await Promise.race([generatePromise, timeoutPromise]);

            const textOutput = response.text ? response.text.trim() : '';
            if (!textOutput) {
                throw new Error('Empty response received from Gemini API');
            }

            // Clean any potential markdown code blocks
            const jsonText = textOutput.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
            const deck = JSON.parse(jsonText);

            // Validasi skema minimum: harus ada daftar slide yang bisa dirender
            if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
                throw new Error('Skema deck tidak valid: slides kosong atau bukan array');
            }

            // Enrich slides with high-resolution stock photos via Pexels / Pixabay / Curated engine
            report(3, 'Menyiapkan visual untuk tiap slide');
            await enrichDeckSlides(deck, prompt, photoOptions);

            deck.modelUsed = modelLabel;
            deck.isLiveGemini = true;

            console.log(`[GeminiAgent] Successfully generated deck with ${deck.slides?.length || 0} slides using ${modelName}`);
            return deck;
        } catch (err) {
            console.error(`[GeminiAgent] Failed with model ${modelName}:`, err.message);
            lastError = err;
            if (/API_KEY_INVALID|API key not valid/i.test(err.message || '')) {
                break;
            }
        }
    }

    // If all live models failed, provide graceful fallback with clear notice
    const rawReason = lastError?.message || 'Gagal memanggil Gemini API';
    let friendlyReason = rawReason;
    if (/API_KEY_INVALID|API key not valid/i.test(rawReason)) {
        friendlyReason = 'API key Gemini tidak valid: periksa kembali key di Pengaturan';
    } else if (/Timeout|sibuk/i.test(rawReason)) {
        friendlyReason = 'Server Gemini sedang padat, menggunakan draf cerdas FlyPtx';
    } else if (/503|UNAVAILABLE|high demand/i.test(rawReason)) {
        friendlyReason = 'Server Gemini sedang padat (503), menggunakan draf cerdas FlyPtx';
    } else if (/429|RESOURCE_EXHAUSTED|quota/i.test(rawReason)) {
        friendlyReason = 'Kuota model Gemini habis sementara (429), menggunakan draf cerdas FlyPtx';
    } else if (/404|NOT_FOUND/i.test(rawReason)) {
        friendlyReason = 'Model tidak tersedia untuk akun ini (404), menggunakan draf cerdas FlyPtx';
    } else {
        try {
            const parsed = JSON.parse(rawReason);
            if (parsed?.error?.message) {
                friendlyReason = parsed.error.message;
            }
        } catch (_) {}
    }
    console.warn('[GeminiAgent] Live Gemini calls failed. Falling back to intelligent deep deck. Reason:', friendlyReason);
    return await generateFallbackDeck(prompt, slideCount, language, friendlyReason, photoOptions, tone);
}

/**
 * Enriches each slide with real stock photos via Pexels / Pixabay / Curated CDN
 * Ensures every slide in the deck gets a UNIQUE photo (no duplicate images across slides).
 */
async function enrichDeckSlides(deck, originalTopic, photoOptions = {}) {
    if (!deck.slides || !Array.isArray(deck.slides)) {
        deck.slides = [];
    }

    const usedUrls = new Set();

    for (let idx = 0; idx < deck.slides.length; idx++) {
        const s = deck.slides[idx];
        s.slideNumber = s.slideNumber || idx + 1;

        // Resolve clean keywords for Pexels / Pixabay search.
        // Gemini kadang mengembalikan imageKeywords sebagai array — normalisasi.
        const rawKw = s.imageKeywords || s.imagePrompt;
        const searchKeywords = Array.isArray(rawKw)
            ? rawKw.join(' ')
            : (rawKw || `${s.title} ${originalTopic}`);

        s.imageUrl = await getStockPhotoUrl(searchKeywords, {
            ...photoOptions,
            slideIndex: idx,
            usedUrls,
            topicPrompt: originalTopic,
        });

        // Normalize points & bullets
        if (s.points && Array.isArray(s.points) && (!s.bullets || s.bullets.length === 0)) {
            s.bullets = s.points.map(p => `**${p.headline || 'Poin'}**: ${p.description || ''}`);
        } else if (s.bullets && Array.isArray(s.bullets) && (!s.points || s.points.length === 0)) {
            s.points = s.bullets.map(b => {
                const parts = b.split('**:');
                if (parts.length > 1) {
                    return {
                        headline: parts[0].replace(/\*\*/g, '').trim(),
                        description: parts.slice(1).join('**:').trim()
                    };
                }
                return { headline: 'Wawasan Kunci', description: b.replace(/\*\*/g, '') };
            });
        }
    }
}

function stripTopicPreamble(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/^(presentasi\s+(tentang|mengenai|berdasarkan\s+dokumen)\s*[:\-]?\s*)/i, '')
        .replace(/^(presentation\s+(about|on|based\s+on)\s*[:\-]?\s*)/i, '')
        .replace(/^(ringkasan\s+(tentang|mengenai|dokumen)\s*[:\-]?\s*)/i, '')
        .trim();
}

/**
 * Fallback generator when Gemini API is offline or key is not set
 */
async function generateFallbackDeck(prompt, slideCount, language, reasonNotice = null, photoOptions = {}, tone = 'executive') {
    const isEn = language === 'en';
    const rawClean = prompt && prompt.trim() ? prompt.trim() : (isEn ? 'Strategic Innovation' : 'Strategi Inovasi');
    const cleanTopic = stripTopicPreamble(rawClean) || rawClean;
    const targetCount = Math.max(3, Math.min(20, parseInt(slideCount, 10) || 5));
    const topicWords = cleanTopic.split(/\s+/).slice(0, 4).join(' ');

    const slides = [];

    // Tone-aware badges and subtitles for fallback
    const TONE_HERO = {
        startup: {
            badge: isEn ? 'STARTUP PITCH' : 'PITCH DECK',
            sub: isEn ? `Disrupting the industry and accelerating 10x growth for ${topicWords}.` : `Disrupsi pasar dan akselerasi pertumbuhan eksponensial untuk ${topicWords}.`,
            note: isEn ? `Opening pitch statement for ${cleanTopic}.` : `Buka dengan narasi problem-solution dan visi pertumbuhan ${cleanTopic}.`
        },
        academic: {
            badge: isEn ? 'SCHOLARLY INQUIRY' : 'KAJIAN AKADEMIK',
            sub: isEn ? `A rigorous methodological investigation and theoretical framework on ${topicWords}.` : `Tinjauan metodologis komprehensif dan kerangka analitis kritis mengenai ${topicWords}.`,
            note: isEn ? `Academic introduction to ${cleanTopic}.` : `Pengantar konseptual dan tinjauan literatur ${cleanTopic}.`
        },
        casual: {
            badge: isEn ? 'INSIGHTFUL GUIDE' : 'PANDUAN SANTAI',
            sub: isEn ? `An engaging and relatable storytelling breakdown of ${topicWords}.` : `Mengenal lebih dekat, memahami inti permasalahan, dan cerita di balik ${topicWords}.`,
            note: isEn ? `Casual welcome to ${cleanTopic}.` : `Sapa audiens dengan santai dan bangun keterhubungan topik ${cleanTopic}.`
        },
        executive: {
            badge: isEn ? 'EXECUTIVE BRIEFING' : 'BRIEFING EKSEKUTIF',
            sub: isEn ? `A comprehensive strategic analysis and decisive framework for ${topicWords}.` : `Analisis strategis komprehensif dan kerangka aksi terukur untuk ${topicWords}.`,
            note: isEn ? `Welcome to the executive presentation on ${cleanTopic}.` : `Selamat datang dalam presentasi eksekutif mengenai ${cleanTopic}.`
        }
    };
    const heroInfo = TONE_HERO[tone] || TONE_HERO.executive;

    // Slide 1: Title Hero
    slides.push({
        slideNumber: 1,
        layout: 'title',
        badge: heroInfo.badge,
        title: cleanTopic,
        subtitle: heroInfo.sub,
        imageKeywords: `${cleanTopic} professional landscape environment`,
        points: [],
        bullets: [],
        keyMetric: '',
        metricLabel: '',
        speakerNotes: heroInfo.note
    });

    // Slide 2: Context & Mechanisms (Split Image Right)
    if (targetCount >= 2) {
        slides.push({
            slideNumber: 2,
            layout: 'split_image_right',
            badge: isEn ? 'CORE MECHANISMS' : 'KONTEKS & MEKANISME',
            title: isEn ? `Foundational Principles of ${topicWords}` : `Pondasi & Karakteristik ${topicWords}`,
            subtitle: isEn ? 'Understanding underlying systemic forces and impact' : 'Memahami dinamika sistemik dan dampak strategis jangka panjang',
            imageKeywords: `${cleanTopic} research science ecosystem`,
            points: isEn ? [
                {
                    headline: 'Systemic Interdependence',
                    description: `${cleanTopic} directly influences operational stability, resource allocation, and multi-sector outcomes.`
                },
                {
                    headline: 'Strategic Imperative',
                    description: 'Addressing structural gaps early prevents compounding long-term liabilities and unlocks measurable growth.'
                }
            ] : [
                {
                    headline: 'Interkoneksi Sistemik',
                    description: `${cleanTopic} secara langsung memengaruhi stabilitas operasional, efisiensi sumber daya, dan ketahanan sektor terkait.`
                },
                {
                    headline: 'Urgensi Strategis',
                    description: 'Intervensi terencana pada tahap awal mencegah eskalasi risiko serta membuka peluang keberlanjutan jangka panjang.'
                }
            ],
            bullets: [],
            keyMetric: '',
            metricLabel: '',
            speakerNotes: isEn ? `Explain systemic relevance.` : `Jelaskan relevansi sistemik.`
        });
    }

    // Slide 3: 3 Pillars (Card Grid 3)
    if (targetCount >= 3) {
        slides.push({
            slideNumber: 3,
            layout: 'card_grid_3',
            badge: isEn ? 'KEY PILLARS' : 'TANTANGAN UTAMA',
            title: isEn ? `Three Dimensions of ${topicWords}` : `Tiga Pilar Tantangan ${topicWords}`,
            subtitle: isEn ? 'Critical structural bottlenecks requiring coordination' : 'Tiga simpul krisis yang menuntut intervensi kebijakan terpadu',
            imageKeywords: `${cleanTopic} strategy coordination teamwork`,
            cards: isEn ? [
                {
                    badge: 'PRESSURE 01',
                    title: 'Structural Gaps',
                    description: 'Systemic friction and outdated protocols hinder rapid real-time response.'
                },
                {
                    badge: 'PRESSURE 02',
                    title: 'Resource Allocation',
                    description: 'Capital constraints and misaligned incentives limit scalability.'
                },
                {
                    badge: 'PRESSURE 03',
                    title: 'Governance & Alignment',
                    description: 'Lack of shared cross-sector transparency undermines execution.'
                }
            ] : [
                {
                    badge: 'TANTANGAN 01',
                    title: 'Kesenjangan Struktural',
                    description: 'Prosedur lama dan friksi operasional menghambat respons cepat di lapangan.'
                },
                {
                    badge: 'TANTANGAN 02',
                    title: 'Alokasi Sumber Daya',
                    description: 'Keterbatasan anggaran dan insentif yang belum selaras membatasi ekspansi dampak.'
                },
                {
                    badge: 'TANTANGAN 03',
                    title: 'Tata Kelola & Sinergi',
                    description: 'Minimnya integrasi data lintas lembaga mengurangi efektivitas mitigasi risiko.'
                }
            ],
            points: [],
            bullets: [],
            keyMetric: '',
            metricLabel: '',
            speakerNotes: isEn ? `Discuss the three dimensions.` : `Bahas ketiga pilar dimensi.`
        });
    }

    // Slide 4: Stat Highlight
    if (targetCount >= 4) {
        slides.push({
            slideNumber: 4,
            layout: 'stat_highlight',
            badge: isEn ? 'EMPIRICAL BENCHMARK' : 'METRIK & DAMPAK',
            title: isEn ? `Quantifying Impact: ${topicWords}` : `Mengukur Urgensi: ${topicWords} dalam Angka`,
            subtitle: isEn ? 'Measurable benchmarks that demonstrate critical necessity' : 'Ambang batas kuantitatif yang membuktikan urgensi tindakan',
            imageKeywords: `${cleanTopic} data analytics benchmark`,
            keyMetric: '85%',
            metricLabel: isEn ? 'Critical Impact Threshold' : 'Tingkat Dampak Terukur',
            points: isEn ? [
                {
                    headline: 'Direct Operational Impact',
                    description: 'Targeted interventions yield measurable efficiency gains within the first deployment cycle.'
                },
                {
                    headline: 'Socio-Economic Value',
                    description: 'Proactive mitigation safeguards critical capital assets and community resilience.'
                }
            ] : [
                {
                    headline: 'Dampak Langsung Terukur',
                    description: 'Intervensi terarah menghasilkan peningkatan efisiensi dan mitigasi risiko signifikan.'
                },
                {
                    headline: 'Nilai Sosial Ekonomi',
                    description: 'Perlindungan proaktif mengamankan aset berharga serta memperkuat ketahanan publik.'
                }
            ],
            bullets: [],
            speakerNotes: isEn ? `Highlight statistical urgency.` : `Tekankan urgensi statistik.`
        });
    }

    // Slide 5: Strategic Action Roadmap
    if (targetCount >= 5) {
        slides.push({
            slideNumber: 5,
            layout: targetCount === 5 ? 'conclusion' : 'split_image_left',
            badge: isEn ? 'STRATEGIC ROADMAP' : 'ROADMAP STRATEGIS',
            title: isEn ? `Decisive Action Pillars for ${topicWords}` : `Langkah Strategis Menuju Solusi Berkelanjutan`,
            subtitle: isEn ? 'A synchronized framework to ensure measurable resilience' : 'Kerangka kerja kolaboratif untuk menjamin keberlanjutan hasil',
            imageKeywords: `${cleanTopic} conservation protection management`,
            points: isEn ? [
                {
                    headline: 'Pillar 1: Data-Driven Surveillance',
                    description: 'Deploy advanced monitoring frameworks to detect anomalies within real-time windows.'
                },
                {
                    headline: 'Pillar 2: Inclusive Stakeholder Financing',
                    description: 'Direct institutional funding to grassroots champions to anchor community ownership.'
                },
                {
                    headline: 'Pillar 3: Transparent Governance Standards',
                    description: 'Establish shared accountability metrics to enforce long-term compliance.'
                }
            ] : [
                {
                    headline: 'Pilar 1: Pengawasan Berbasis Data Real-Time',
                    description: 'Mengintegrasikan teknologi sensor dan analitik untuk mendeteksi deviasi secara cepat.'
                },
                {
                    headline: 'Pilar 2: Pendanaan Inklusif Berkelanjutan',
                    description: 'Menyalurkan sumber daya langsung kepada garda depan pelaksana di lapangan.'
                },
                {
                    headline: 'Pilar 3: Standar Kepatuhan & Transparansi',
                    description: 'Menetapkan tolok ukur terukur antar pemangku kepentingan untuk menjamin integritas.'
                }
            ],
            bullets: [],
            keyMetric: '',
            metricLabel: '',
            speakerNotes: isEn ? `Close with strong conviction.` : `Tutup dengan keyakinan kuat.`
        });
    }

    // Slides 6 through targetCount (if requested count > 5)
    const extraSlideConfigs = [
        {
            layout: 'split_image_right',
            badge: isEn ? 'FIELD IMPLEMENTATION' : 'PRAKTIK & IMPLEMENTASI',
            title: isEn ? `Field Dynamics & Execution for ${topicWords}` : `Implementasi Nyata & Dinamika Lapangan ${topicWords}`,
            subtitle: isEn ? 'Translating strategic guidelines into localized ground operations' : 'Menerjemahkan arahan strategis menjadi aksi nyata terkoordinasi di lapangan',
            imageKeywords: `${cleanTopic} fieldwork operations drone forest`,
            points: isEn ? [
                { headline: 'Rapid Field Deployment', description: 'Cross-functional response units achieve frontline readiness within hours.' },
                { headline: 'Local Community Integration', description: 'Co-designing protocols with local guardians anchors operational longevity.' }
            ] : [
                { headline: 'Pengerahan Cepat Lapangan', description: 'Unit reaksi cepat lintas sektor mencapai kesiapan penuh dalam hitungan jam.' },
                { headline: 'Kemitraan Komunitas Lokal', description: 'Melibatkan masyarakat setempat memastikan protokol berjalan berkelanjutan.' }
            ]
        },
        {
            layout: 'card_grid_3',
            badge: isEn ? 'RISK GOVERNANCE' : 'MITIGASI RISIKO',
            title: isEn ? `Risk Governance Framework for ${topicWords}` : `Matriks Mitigasi Risiko & Tata Kelola ${topicWords}`,
            subtitle: isEn ? 'Comprehensive risk matrix safeguarding strategic investments' : 'Matriks mitigasi menyeluruh untuk melindungi aset dan keberlangsungan program',
            imageKeywords: `${cleanTopic} security shield compliance`,
            cards: isEn ? [
                { badge: 'MITIGATION 01', title: 'Operational Risk', description: 'Standardized SOPs mitigate frontline vulnerabilities.' },
                { badge: 'MITIGATION 02', title: 'Regulatory Compliance', description: 'Transparent reporting ensures uninterrupted licensing.' },
                { badge: 'MITIGATION 03', title: 'Socio-Environmental', description: 'Continuous baseline audits maintain ecological integrity.' }
            ] : [
                { badge: 'MITIGASI 01', title: 'Risiko Operasional', description: 'SOP standar mencegah kerentanan di garis depan.' },
                { badge: 'MITIGASI 02', title: 'Kepatuhan Regulasi', description: 'Pelaporan transparan menjamin kepatuhan hukum berkelanjutan.' },
                { badge: 'MITIGASI 03', title: 'Dampak Sosial Lingkungan', description: 'Audit berkala menjaga integritas ekologis dan sosial.' }
            ]
        },
        {
            layout: 'stat_highlight',
            badge: isEn ? 'LONG-TERM HORIZONS' : 'TARGET & TOLOK UKUR',
            title: isEn ? `Target Trajectory for ${topicWords}` : `Target Pencapaian & Tolok Ukur ${topicWords}`,
            subtitle: isEn ? 'Key performance indicators for strategic milestones' : 'Indikator kinerja utama menuju keberhasilan jangka panjang',
            imageKeywords: `${cleanTopic} future horizon growth satellite`,
            keyMetric: '99.4%',
            metricLabel: isEn ? 'Systemic Integrity Target' : 'Target Integritas Sistemik',
            points: isEn ? [
                { headline: 'Sustained Resilience', description: 'Protocols build durable defense against exogenous shocks.' },
                { headline: 'Scalable Framework', description: 'Model can be seamlessly expanded across adjacent territories.' }
            ] : [
                { headline: 'Ketahanan Berkelanjutan', description: 'Mekanisme terpadu membentuk benteng tangguh menghadapi disrupsi.' },
                { headline: 'Skalabilitas Model', description: 'Kerangka kerja dapat direplikasi ke wilayah dan sektor lain dengan mudah.' }
            ]
        },
        {
            layout: 'conclusion',
            badge: isEn ? 'EXECUTIVE DIRECTIVES' : 'KESIMPULAN & AKSI',
            title: isEn ? `Strategic Synthesis & Mandate for ${topicWords}` : `Sintesis Strategis & Mandat Aksi ${topicWords}`,
            subtitle: isEn ? 'A united operational mandate for measurable transformation' : 'Mandat bersama untuk mewujudkan transformasi nyata terukur',
            imageKeywords: `${cleanTopic} global earth sunrise partnership`,
            points: isEn ? [
                { headline: 'Unified Leadership Mandate', description: 'Align leadership across all participating departments.' },
                { headline: 'Immediate Resource Mobilization', description: 'Unlock catalytic funding for fast-track pilot execution.' }
            ] : [
                { headline: 'Komitmen Kepemimpinan Tunggal', description: 'Menyatukan visi seluruh pemangku kepentingan dalam satu komando terarah.' },
                { headline: 'Mobilisasi Sumber Daya Cepat', description: 'Mencairkan dukungan finansial katalitis untuk percepatan tahap percontohan.' }
            ]
        }
    ];

    while (slides.length < targetCount) {
        const nextIdx = slides.length + 1;
        const cfgIndex = (nextIdx - 6) % extraSlideConfigs.length;
        const cfg = extraSlideConfigs[cfgIndex];
        slides.push({
            slideNumber: nextIdx,
            layout: nextIdx === targetCount ? 'conclusion' : cfg.layout,
            badge: cfg.badge,
            title: cfg.title,
            subtitle: cfg.subtitle,
            imageKeywords: cfg.imageKeywords,
            points: cfg.points || [],
            cards: cfg.cards || [],
            bullets: [],
            keyMetric: cfg.keyMetric || '',
            metricLabel: cfg.metricLabel || '',
            speakerNotes: isEn ? `Discuss slide ${nextIdx}.` : `Bahas poin slide ke-${nextIdx}.`
        });
    }

    const deck = {
        deckTitle: cleanTopic,
        deckSubtitle: isEn
            ? `An authoritative strategic framework for ${topicWords}`
            : `Kerangka kerja strategis dan analisis komprehensif mengenai ${topicWords}`,
        category: isEn ? 'Strategic Analysis' : 'Analisis Strategis',
        theme: 'forest_green',
        slides,
        isLiveGemini: false,
        reasonNotice
    };

    await enrichDeckSlides(deck, cleanTopic, photoOptions);
    return deck;
}
