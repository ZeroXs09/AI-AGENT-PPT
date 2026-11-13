/**
 * Stock Photo Service for FlyPtx AI Agent
 * Supports Pexels API, Pixabay API, and reliable high-res curated stock photo fallback.
 * Guarantees unique, contextually relevant photos across all slides in a deck.
 */

// Kamus translasi kata kunci visual Indonesia -> Inggris agar pencarian Pexels/Pixabay akurat
const ID_TO_EN_VISUAL_MAP = {
    hutan: 'rainforest forest trees',
    amazon: 'amazon rainforest jungle',
    rimba: 'jungle tropical forest',
    alam: 'nature landscape wilderness',
    lingkungan: 'environment ecology nature',
    ekosistem: 'ecosystem nature biodiversity',
    satwa: 'wildlife animals nature',
    hewan: 'wildlife animal nature',
    burung: 'tropical bird wildlife',
    sungai: 'river water landscape',
    laut: 'ocean sea underwater',
    samudra: 'ocean sea waves',
    pantai: 'beach coast ocean',
    terumbu: 'coral reef underwater',
    gunung: 'mountain peak landscape',
    iklim: 'climate earth atmosphere',
    pemanasan: 'global warming climate',
    sampah: 'recycling waste environment',
    plastik: 'plastic pollution recycling',
    sirkular: 'circular economy sustainability',
    energi: 'renewable energy solar wind',
    surya: 'solar panel renewable energy',
    listrik: 'electricity power grid',
    pertanian: 'agriculture farming crops',
    pangan: 'food agriculture harvest',
    kopi: 'coffee beans cafe barista',
    kesehatan: 'healthcare medical doctor',
    medis: 'medical hospital healthcare',
    dokter: 'doctor hospital medical',
    rumah: 'architecture building modern',
    pendidikan: 'education students classroom',
    sekolah: 'school classroom students',
    kampus: 'university campus students',
    mahasiswa: 'university students learning',
    teknologi: 'technology digital innovation',
     kecerdasan: 'artificial intelligence technology',
    buatan: 'artificial intelligence futuristic',
    data: 'data analytics dashboard',
    keamanan: 'cybersecurity digital security',
    bisnis: 'business corporate office',
    ekonomi: 'economy finance market',
    keuangan: 'finance investment banking',
    pemasaran: 'marketing strategy creative',
    produk: 'product design studio',
    desain: 'creative design studio',
    kreatif: 'creative studio workspace',
    kota: 'modern city urban architecture',
    transportasi: 'transportation transit infrastructure',
    sejarah: 'history heritage architecture',
    budaya: 'culture heritage traditional',
    nusantara: 'indonesia archipelago landscape',
    indonesia: 'indonesia tropical landscape',
};

// Kata-kata meta presentasi (Indonesia & Inggris) yang harus dibuang agar tidak merusak pencarian foto
const STOP_WORDS = new Set([
    'presentasi', 'tentang', 'mengenai', 'berdasarkan', 'dokumen', 'materi',
    'topik', 'poin', 'kunci', 'penting', 'slide', 'analisis', 'strategis',
    'strategi', 'kerangka', 'kerja', 'pengenalan', 'studi', 'kasus', 'makalah',
    'laporan', 'proposal', 'pondasi', 'dinamika', 'tiga', 'pilar', 'tantangan',
    'mengukur', 'urgensi', 'langkah', 'menuju', 'solusi', 'berkelanjutan',
    'dalam', 'angka', 'dan', 'atau', 'yang', 'untuk', 'pada', 'dari', 'dengan',
    'oleh', 'sebagai', 'menjadi', 'tidak', 'ada', 'ini', 'itu', 'lebih',
    'presentation', 'about', 'overview', 'introduction', 'executive', 'briefing',
    'professional', 'framework', 'foundational', 'principles', 'dimensions',
    'quantifying', 'impact', 'decisive', 'action', 'pillars', 'cinematic',
    'photo', 'photography', 'high', 'resolution', '8k', 'shot', 'view', 'wide',
    'overhead', 'realistic', 'ultra', 'style', 'documentary', 'dramatic', 'lighting',
]);

// Variasi sudut visual per nomor slide agar tiap slide punya nuansa foto yang berbeda
const SLIDE_VISUAL_ANGLES = [
    'landscape wide',
    'nature environment',
    'ecosystem canopy',
    'river water',
    'conservation earth',
    'sunlight trees',
    'aerial view',
    'biodiversity flora',
];

/**
 * Searches for a professional stock photo using Pexels, Pixabay, or reliable CDN fallback.
 * @param {string} searchPrompt - Topic or English keywords for image search
 * @param {Object} options - { pexelsKey, pixabayKey, slideIndex, usedUrls, topicPrompt }
 * @returns {Promise<string>} - Direct URL of high-resolution image
 */
export async function getStockPhotoUrl(searchPrompt = '', options = {}) {
    const pexelsKey = options.pexelsKey || process.env.PEXELS_API_KEY;
    const pixabayKey = options.pixabayKey || process.env.PIXABAY_API_KEY;
    const slideIndex = Number.isInteger(options.slideIndex) ? options.slideIndex : 0;
    const usedUrls = options.usedUrls instanceof Set ? options.usedUrls : new Set();

    // Bersihkan & terjemahkan kata kunci pencarian
    const cleanQuery = extractKeywords(searchPrompt, slideIndex, options.topicPrompt || '');

    // 1. Try Pexels API if key is available
    if (pexelsKey && pexelsKey.trim().length > 5) {
        try {
            const pexelsUrl = await fetchPexelsPhoto(cleanQuery, pexelsKey.trim(), slideIndex, usedUrls);
            if (pexelsUrl) {
                console.log(`[ImageService] Pexels photo [slide ${slideIndex + 1}] found for: "${cleanQuery}"`);
                return pexelsUrl;
            }
        } catch (err) {
            console.warn('[ImageService] Pexels API error:', err.message);
        }
    }

    // 2. Try Pixabay API if key is available
    if (pixabayKey && pixabayKey.trim().length > 5) {
        try {
            const pixabayUrl = await fetchPixabayPhoto(cleanQuery, pixabayKey.trim(), slideIndex, usedUrls);
            if (pixabayUrl) {
                console.log(`[ImageService] Pixabay photo [slide ${slideIndex + 1}] found for: "${cleanQuery}"`);
                return pixabayUrl;
            }
        } catch (err) {
            console.warn('[ImageService] Pixabay API error:', err.message);
        }
    }

    // 3. High-Quality Curated Direct Stock Photo Fallback
    return getCuratedStockPhoto(cleanQuery, slideIndex, usedUrls);
}

/**
 * Pilih item unik dari daftar hasil foto yang belum pernah dipakai di slide lain
 */
function pickUniqueItem(items, getUrl, getId, slideIndex, usedUrls) {
    if (!Array.isArray(items) || items.length === 0) return null;

    // Mulai dari offset slideIndex agar tiap slide langsung mengambil kandidat berbeda
    const total = items.length;
    for (let offset = 0; offset < total; offset++) {
        const item = items[(slideIndex + offset) % total];
        const url = getUrl(item);
        const id = getId ? getId(item) : url;
        if (!url) continue;
        if (!usedUrls.has(url) && (!id || !usedUrls.has(`id:${id}`))) {
            usedUrls.add(url);
            if (id) usedUrls.add(`id:${id}`);
            return url;
        }
    }

    // Jika semua sudah terpakai, ambil berdasarkan slideIndex
    const fallbackItem = items[slideIndex % total];
    const fallbackUrl = getUrl(fallbackItem);
    if (fallbackUrl) usedUrls.add(fallbackUrl);
    return fallbackUrl || null;
}

/**
 * Pexels API Fetcher (per_page=20 + deduplikasi antar-slide)
 */
async function fetchPexelsPhoto(query, apiKey, slideIndex = 0, usedUrls = new Set()) {
    const queriesToTry = buildFallbackQueries(query);

    for (const q of queriesToTry) {
        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=20&orientation=landscape`;
        const res = await fetch(url, {
            headers: { Authorization: apiKey },
            signal: AbortSignal.timeout(6000)
        });

        if (!res.ok) {
            throw new Error(`Pexels HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data.photos && data.photos.length > 0) {
            const chosen = pickUniqueItem(
                data.photos,
                p => p.src?.large2x || p.src?.large || p.src?.medium,
                p => p.id,
                slideIndex,
                usedUrls
            );
            if (chosen) return chosen;
        }
    }
    return null;
}

/**
 * Pixabay API Fetcher (per_page=20 + filter relevan + deduplikasi antar-slide)
 */
async function fetchPixabayPhoto(query, apiKey, slideIndex = 0, usedUrls = new Set()) {
    const queriesToTry = buildFallbackQueries(query);
    const isForestTopic = /\b(rainforest|forest|jungle|amazon|trees|nature)\b/i.test(query);
    const wantsBirdOrAnimal = /\b(bird|parrot|macaw|wildlife|animal|fauna)\b/i.test(query);

    for (const q of queriesToTry) {
        const url = `https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(q)}&image_type=photo&orientation=horizontal&per_page=20&safesearch=true`;
        const res = await fetch(url, {
            signal: AbortSignal.timeout(6000)
        });

        if (!res.ok) {
            throw new Error(`Pixabay HTTP ${res.status}`);
        }

        const data = await res.json();
        let hits = Array.isArray(data.hits) ? data.hits : [];

        // Jika topik tentang hutan/Amazon secara umum (bukan khusus burung),
        // prioritaskan foto lanskap hutan/sungai/pepohonan daripada close-up burung beo/macaw
        if (isForestTopic && !wantsBirdOrAnimal && hits.length > 2) {
            const landscapeHits = hits.filter(h => !/\b(parrot|macaw|parakeet|cockatoo|bird head|beak)\b/i.test(h.tags || ''));
            if (landscapeHits.length >= 2) {
                hits = landscapeHits;
            }
        }

        // Jika hasil terlalu sedikit (< 2) dan masih ada query yang lebih umum, lanjut ke query berikutnya
        if (hits.length === 0) continue;

        const chosen = pickUniqueItem(
            hits,
            h => h.largeImageURL || h.webformatURL,
            h => h.id,
            slideIndex,
            usedUrls
        );
        if (chosen) return chosen;
    }
    return null;
}

/**
 * Buat daftar query dari spesifik (4 kata) ke lebih umum (2-3 kata inti)
 * agar jika query 4 kata terlalu sempit di Pixabay/Pexels, otomatis dapat banyak pilihan foto.
 */
function buildFallbackQueries(query) {
    const words = String(query || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return ['business presentation'];

    const list = [words.slice(0, 4).join(' ')];
    if (words.length > 3) {
        list.push(words.slice(0, 3).join(' '));
    }
    if (words.length > 2) {
        list.push(words.slice(0, 2).join(' '));
    }
    return [...new Set(list)];
}

/**
 * High-res curated photo pools for popular topics (multiple distinct photos per topic!)
 */
const CURATED_TOPIC_POOLS = {
    amazon: [
        'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1448375240586-882707db888b?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=900&auto=format&fit=crop&q=80',
    ],
    rainforest: [
        'https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1448375240586-882707db888b?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1511497584788-876760111969?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=900&auto=format&fit=crop&q=80',
    ],
    forest: [
        'https://images.unsplash.com/photo-1448375240586-882707db888b?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1511497584788-876760111969?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=900&auto=format&fit=crop&q=80',
    ],
    nature: [
        'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=900&auto=format&fit=crop&q=80',
    ],
    health: [
        'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1584515979956-d9f6e5d09982?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=900&auto=format&fit=crop&q=80',
    ],
    technology: [
        'https://images.unsplash.com/photo-1518770660439-4636190af475?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=900&auto=format&fit=crop&q=80',
    ],
    business: [
        'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1559526324-4b87b5e36e44?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1497366216548-37526070297c?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=900&auto=format&fit=crop&q=80',
    ],
    education: [
        'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=900&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=900&auto=format&fit=crop&q=80',
    ],
};

/**
 * Resolves a curated stock photo or deterministic Fastly CDN seed photo (unique per slide)
 */
function getCuratedStockPhoto(query, slideIndex = 0, usedUrls = new Set()) {
    const qLower = query.toLowerCase();
    for (const [key, pool] of Object.entries(CURATED_TOPIC_POOLS)) {
        if (qLower.includes(key)) {
            const chosen = pickUniqueItem(pool, u => u, u => u, slideIndex, usedUrls);
            if (chosen) return chosen;
        }
    }
    const seed = encodeURIComponent(`${query.replace(/\s+/g, '-').substring(0, 28)}-s${slideIndex + 1}`);
    const url = `https://picsum.photos/seed/${seed}/900/600`;
    usedUrls.add(url);
    return url;
}

/**
 * Extracts 3-4 clean English visual keywords from complex Indonesian/English prompts
 */
function extractKeywords(prompt = '', slideIndex = 0, topicPrompt = '') {
    if (Array.isArray(prompt)) prompt = prompt.join(' ');
    const combinedRaw = `${prompt || ''} ${topicPrompt || ''}`.toLowerCase();

    const rawWords = String(prompt || '')
        .toLowerCase()
        .replace(/["'\n\r\t]/g, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    const translatedTokens = [];
    for (const w of rawWords) {
        if (ID_TO_EN_VISUAL_MAP[w]) {
            translatedTokens.push(...ID_TO_EN_VISUAL_MAP[w].split(' '));
        } else {
            translatedTokens.push(w);
        }
    }

    // Jika topik adalah Hutan Amazon, pastikan kata "rainforest" / "forest" selalu mendampingi "amazon"
    // dan tambahkan variasi sudut visual per slide (sungai, kanopi, hutan hujan, konservasi, dll.)
    if (/\bamazon\b/i.test(combinedRaw) && /\b(hutan|rainforest|forest|jungle|tropis|alam)\b/i.test(combinedRaw)) {
        const amazonVariants = [
            'amazon rainforest jungle canopy',
            'tropical rainforest river nature',
            'jungle forest trees mist',
            'rainforest ecosystem waterfall nature',
            'tropical forest conservation earth',
            'amazon river tropical forest',
        ];
        return amazonVariants[slideIndex % amazonVariants.length];
    }

    // Hilangkan duplikat kata dengan tetap mempertahankan urutan
    const uniqueWords = [...new Set(translatedTokens.filter(w => w.length > 2 && !STOP_WORDS.has(w)))];

    if (uniqueWords.length === 0) {
        const angle = SLIDE_VISUAL_ANGLES[slideIndex % SLIDE_VISUAL_ANGLES.length];
        return `modern ${angle}`;
    }

    // Jika kata kunci terlalu pendek (1-2 kata), tambahkan variasi sudut visual per slide
    if (uniqueWords.length <= 2) {
        const angle = SLIDE_VISUAL_ANGLES[slideIndex % SLIDE_VISUAL_ANGLES.length].split(' ')[0];
        if (!uniqueWords.includes(angle)) uniqueWords.push(angle);
    }

    return uniqueWords.slice(0, 4).join(' ');
}
