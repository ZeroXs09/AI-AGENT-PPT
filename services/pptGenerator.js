import pptxgen from 'pptxgenjs';

/**
 * Service to generate styled PowerPoint (.pptx) presentation
 * with varied color palettes and dynamic natural layouts per slide.
 * Optimized with shrinkText / autoFit to prevent PowerPoint text overflow.
 */

// Layout helpers kept as stable values: random jitter misaligned elements between slides,
// so every position now resolves to its exact base value.
function getLayoutVariation(slideIndex, baseValue, variationPercent = 0.05) {
    return baseValue;
}

function getRandomOffset(slideIndex, range = 0.1) {
    return 0;
}

export async function generatePptxFile(deckData, themeOverride = null) {
    const pres = new pptxgen();
    pres.layout = 'LAYOUT_16x9';
    pres.title = deckData.deckTitle || 'FlyPtx Presentation';
    pres.author = 'FlyPtx AI Agent';
    pres.company = 'FlyPtx';

    // Theme selector: supports 'dark', 'light', 'emerald', 'navy', 'burgundy', 'sunset'
    const activeTheme = themeOverride || deckData.theme || 'dark';

    // Palet monokrom sinkron dengan tema web FlyPtx (putih-hitam).
    // Satu deck satu tema, konsisten dengan pilihan tema di web.
    const MONO_LIGHT = {
        name: 'Mono Light',
        bg: 'FAFAFA', cardBg: 'FFFFFF', cardBorder: 'E4E4E7',
        cardHighlight: 'F4F4F5', cardCream: 'F4F4F5',
        textWhite: '111112', textAccent: '3F3F46', textMuted: '71717A',
        accentPrimary: '111112', accentSecondary: '71717A', darkText: '111112',
    };
    const MONO_DARK = {
        name: 'Mono Dark',
        bg: '0B0C0D', cardBg: '17181A', cardBorder: '26272B',
        cardHighlight: '202124', cardCream: '26272B',
        textWhite: 'F5F5F4', textAccent: 'C9C9CE', textMuted: '8E8E96',
        accentPrimary: 'FAFAFA', accentSecondary: 'A1A1AA', darkText: '0B0C0D',
    };
    const EMERALD = {
        name: 'Emerald',
        bg: '0A1A14', cardBg: '12261C', cardBorder: '1A3829',
        cardHighlight: '163422', cardCream: '1A3829',
        textWhite: 'E8F5E9', textAccent: '81C784', textMuted: '66BB6A',
        accentPrimary: '4CAF50', accentSecondary: '81C784', darkText: '0A1A14',
    };
    const NAVY = {
        name: 'Navy',
        bg: '0B1120', cardBg: '131D33', cardBorder: '1C2D4A',
        cardHighlight: '17253F', cardCream: '1C2D4A',
        textWhite: 'E3F2FD', textAccent: '90CAF9', textMuted: '64B5F6',
        accentPrimary: '42A5F5', accentSecondary: '90CAF9', darkText: '0B1120',
    };
    const BURGUNDY = {
        name: 'Burgundy',
        bg: '1A0A0E', cardBg: '2A1218', cardBorder: '3D1C24',
        cardHighlight: '32161E', cardCream: '3D1C24',
        textWhite: 'FCE4EC', textAccent: 'EF9A9A', textMuted: 'E57373',
        accentPrimary: 'EF5350', accentSecondary: 'EF9A9A', darkText: '1A0A0E',
    };
    const SUNSET = {
        name: 'Sunset',
        bg: '1A1008', cardBg: '261A10', cardBorder: '3D2A18',
        cardHighlight: '2E2014', cardCream: '3D2A18',
        textWhite: 'FFF3E0', textAccent: 'FFCC80', textMuted: 'FFB74D',
        accentPrimary: 'FF9800', accentSecondary: 'FFCC80', darkText: '1A1008',
    };

    const THEME_MAP = {
        dark: MONO_DARK,
        light: MONO_LIGHT,
        emerald: EMERALD,
        navy: NAVY,
        burgundy: BURGUNDY,
        sunset: SUNSET,
    };
    const colorPalettes = [THEME_MAP[activeTheme] || MONO_DARK];

    const slides = deckData.slides || [];

    // Satu palet brand untuk seluruh deck; variasi datang dari layout slide
    const getSlideColors = () => {
        const palette = colorPalettes[0];
        return {
            bg: palette.bg,
            cardBg: palette.cardBg,
            cardBorder: palette.cardBorder,
            cardGreen: palette.cardHighlight,
            cardCream: palette.cardCream,
            textWhite: palette.textWhite,
            textMint: palette.textAccent,
            textMuted: palette.textMuted,
            accentGreen: palette.accentPrimary,
            accentGold: palette.accentSecondary,
            darkText: palette.darkText,
        };
    };

    slides.forEach((s, idx) => {
        const slide = pres.addSlide();

        // Get varied colors per slide type & index
        const C = getSlideColors(idx, s.layout);
        slide.background = { color: C.bg };

        // Add speaker notes if present
        if (s.speakerNotes) {
            slide.addNotes(s.speakerNotes);
        }

        switch (s.layout) {
            case 'title':
                renderTitleSlide(pres, slide, s, deckData, C);
                break;
            case 'split_image_right':
                renderSplitImageRight(pres, slide, s, idx + 1, slides.length, C);
                break;
            case 'split_image_left':
                renderSplitImageLeft(pres, slide, s, idx + 1, slides.length, C);
                break;
            case 'card_grid_3':
                renderCardGrid3(pres, slide, s, idx + 1, slides.length, C);
                break;
            case 'stat_highlight':
                renderStatHighlightSlide(pres, slide, s, idx + 1, slides.length, C);
                break;
            case 'conclusion':
                renderConclusionSlide(pres, slide, s, idx + 1, slides.length, C);
                break;
            case 'two_column':
                renderTwoColumnSlide(pres, slide, s, idx + 1, slides.length, C);
                break;
            case 'bullet_list':
            default:
                if (s.imageUrl) {
                    renderSplitImageRight(pres, slide, s, idx + 1, slides.length, C);
                } else {
                    renderBulletListSlide(pres, slide, s, idx + 1, slides.length, C);
                }
                break;
        }
    });

    // Write to Node Buffer
    const buffer = await pres.write({ outputType: 'nodebuffer' });
    return buffer;
}

/**
 * Slide Layout 1: Title Slide (Gamma Hero Style)
 */
function renderTitleSlide(pres, slide, s, deckData, C) {
    const hasImage = Boolean(s.imageUrl);

    // Natural varied positioning for accent elements
    const titleY = 1.2 + getRandomOffset(1, 0.05);
    const accentX = 0.8 + getRandomOffset(2, 0.1);

    // Decorative top accent bar - varied position & width
    slide.addShape(pres.ShapeType.rect, {
        x: accentX,
        y: 0.6 + getRandomOffset(3, 0.02),
        w: 1.2 + getRandomOffset(4, 0.1),
        h: 0.05,
        fill: { color: C.accentGreen },
        line: { color: C.accentGreen }
    });

    // Brand / Category Badge - subtle positioning variation
    const badgeY = 0.75 + getRandomOffset(5, 0.03);
    slide.addText((s.badge || deckData.category || 'FLYPTX AI AGENT').toUpperCase(), {
        x: 0.8 + getRandomOffset(6, 0.05),
        y: badgeY,
        w: hasImage ? 4.6 : 8.4,
        h: 0.35,
        fontSize: 10,
        color: C.textMuted,
        bold: true,
        charSpacing: 2,
        fontFace: 'Arial'
    });

    // Hero Deck Title - dynamic sizing and position
    const titleText = s.title || deckData.deckTitle || 'Presentasi FlyPtx';
    const titleSize = Math.max(24, Math.min(32, 32 - Math.max(0, titleText.length - 30) * 0.3));
    const titleHeight = Math.max(1.6, Math.min(2.0, titleText.length > 80 ? 2.2 : 1.8));

    slide.addText(titleText, {
        x: 0.8 + getRandomOffset(7, 0.03),
        y: titleY,
        w: hasImage ? 4.5 : 8.4,
        h: titleHeight,
        fontSize: titleSize,
        color: C.textWhite,
        bold: true,
        fontFace: 'Arial',
        valign: 'top',
        wrap: true,
        shrinkText: true,
        autoFit: true,
        lineSpacingMultiple: 1.15,
    });

    // Subtitle / Thesis
    if (s.subtitle || deckData.deckSubtitle) {
        const subtitleY = titleY + titleHeight + 0.15 + getRandomOffset(8, 0.02);
        slide.addText(s.subtitle || deckData.deckSubtitle, {
            x: 0.8 + getRandomOffset(9, 0.02),
            y: subtitleY,
            w: hasImage ? 4.5 : 8.4,
            h: 1.2,
            fontSize: 13,
            color: C.textMint,
            fontFace: 'Arial',
            valign: 'top',
            wrap: true,
            shrinkText: true,
            autoFit: true,
            lineSpacingMultiple: 1.1,
        });
    }

    // Hero Image on Right (if present) - varied positioning
    if (hasImage) {
        const imageX = 5.5 + getRandomOffset(10, 0.05);
        const imageY = 0.8 + getRandomOffset(11, 0.03);
        const imageW = 3.7 + getRandomOffset(12, 0.05);
        const imageH = 3.8 + getRandomOffset(13, 0.05);

        slide.addShape(pres.ShapeType.roundRect, {
            x: imageX,
            y: imageY,
            w: imageW,
            h: imageH,
            rectRadius: 0.15,
            fill: { color: C.cardBg },
            line: { color: C.cardBorder, width: 1.5 }
        });

        tryAddImage(slide, s.imageUrl, {
            x: imageX,
            y: imageY,
            w: imageW,
            h: imageH,
            rounding: true
        });
    }

    // Bottom Decorative Bar & Watermark - varied positioning
    const bottomBarY = 4.85 + getRandomOffset(14, 0.02);
    slide.addShape(pres.ShapeType.line, {
        x: 0.8,
        y: bottomBarY,
        w: 8.4,
        h: 0,
        line: { color: C.cardBorder, width: 1 }
    });

    slide.addText('FlyPtx AI Agent • Presentation Intelligence', {
        x: 0.8 + getRandomOffset(15, 0.03),
        y: bottomBarY + 0.15,
        w: 4.0,
        h: 0.3,
        fontSize: 9.5,
        color: C.textMuted,
        fontFace: 'Arial'
    });

    slide.addText('Powered by Google Gemini & Stock Photo API', {
        x: 5.2 + getRandomOffset(16, 0.03),
        y: bottomBarY + 0.15,
        w: 4.0,
        h: 0.3,
        fontSize: 9.5,
        color: C.textMuted,
        align: 'right',
        fontFace: 'Arial'
    });
}

/**
 * Slide Layout 2: Split Image Right (Gamma Signature Style)
 * Deep narrative & structured analysis on Left, HD Photo on Right
 */
function renderSplitImageRight(pres, slide, s, currentNum, totalNum, C) {
    renderSlideHeader(pres, slide, s, currentNum, totalNum, C, 4.8);

    // Left Content Card - varied positioning
    const cardX = 0.8 + getRandomOffset(currentNum * 100, 0.03);
    const cardY = 1.6 + getRandomOffset(currentNum * 101, 0.02);
    const cardW = 4.8 + getRandomOffset(currentNum * 102, 0.05);
    const cardH = 3.35 + getRandomOffset(currentNum * 103, 0.03);

    slide.addShape(pres.ShapeType.roundRect, {
        x: cardX,
        y: cardY,
        w: cardW,
        h: cardH,
        rectRadius: 0.15,
        fill: { color: C.cardBg },
        line: { color: C.cardBorder, width: 1 }
    });

    const textItems = formatPointsToTextItems(s, C);
    slide.addText(textItems, {
        x: cardX + 0.15,
        y: cardY + 0.1,
        w: cardW - 0.3,
        h: cardH - 0.2,
        valign: 'top',
        wrap: true,
        shrinkText: true,
        autoFit: true,
        margin: [0.04, 0.04, 0.04, 0.04]
    });

    // Right Image - varied positioning and dimensions
    if (s.imageUrl) {
        const imageX = 5.8 + getRandomOffset(currentNum * 104, 0.04);
        const imageY = 0.85 + getRandomOffset(currentNum * 105, 0.03);
        const imageW = 3.4 + getRandomOffset(currentNum * 106, 0.06);
        const imageH = 4.1 + getRandomOffset(currentNum * 107, 0.05);

        slide.addShape(pres.ShapeType.roundRect, {
            x: imageX,
            y: imageY,
            w: imageW,
            h: imageH,
            rectRadius: 0.15,
            fill: { color: C.cardBg },
            line: { color: C.cardBorder, width: 1 }
        });

        tryAddImage(slide, s.imageUrl, {
            x: imageX,
            y: imageY,
            w: imageW,
            h: imageH,
            rounding: true
        });
    }
}

/**
 * Slide Layout 3: Split Image Left
 * HD Photo on Left, Deep narrative on Right
 */
function renderSplitImageLeft(pres, slide, s, currentNum, totalNum, C) {
    // Left Image - varied positioning
    if (s.imageUrl) {
        const imageX = 0.8 + getRandomOffset(currentNum * 200, 0.04);
        const imageY = 0.85 + getRandomOffset(currentNum * 201, 0.03);
        const imageW = 3.4 + getRandomOffset(currentNum * 202, 0.06);
        const imageH = 4.1 + getRandomOffset(currentNum * 203, 0.05);

        slide.addShape(pres.ShapeType.roundRect, {
            x: imageX,
            y: imageY,
            w: imageW,
            h: imageH,
            rectRadius: 0.15,
            fill: { color: C.cardBg },
            line: { color: C.cardBorder, width: 1 }
        });

        tryAddImage(slide, s.imageUrl, {
            x: imageX,
            y: imageY,
            w: imageW,
            h: imageH,
            rounding: true
        });
    }

    // Right Header & Content
    renderSlideHeaderCustom(pres, slide, s, currentNum, totalNum, C, 4.5, 4.7);

    // Right Content Card - varied positioning
    const cardX = 4.5 + getRandomOffset(currentNum * 204, 0.03);
    const cardY = 1.6 + getRandomOffset(currentNum * 205, 0.02);
    const cardW = 4.7 + getRandomOffset(currentNum * 206, 0.05);
    const cardH = 3.35 + getRandomOffset(currentNum * 207, 0.03);

    slide.addShape(pres.ShapeType.roundRect, {
        x: cardX,
        y: cardY,
        w: cardW,
        h: cardH,
        rectRadius: 0.15,
        fill: { color: C.cardBg },
        line: { color: C.cardBorder, width: 1 }
    });

    const textItems = formatPointsToTextItems(s, C);
    slide.addText(textItems, {
        x: cardX + 0.15,
        y: cardY + 0.1,
        w: cardW - 0.3,
        h: cardH - 0.2,
        valign: 'top',
        wrap: true,
        shrinkText: true,
        autoFit: true,
        margin: [0.04, 0.04, 0.04, 0.04]
    });
}

/**
 * Slide Layout 4: Card Grid 3 (Gamma 3-Pillar Comparison) - Dynamic positions
 */
function renderCardGrid3(pres, slide, s, currentNum, totalNum, C) {
    renderSlideHeader(pres, slide, s, currentNum, totalNum, C, 8.4);

    const cards = Array.isArray(s.cards) && s.cards.length === 3
        ? s.cards
        : (s.points && s.points.length >= 3
            ? s.points.slice(0, 3).map((p, i) => ({ badge: `PILAR 0${i + 1}`, title: p.headline, description: p.description }))
            : [
                { badge: 'PILAR 01', title: 'Dimensi Ekologis', description: 'Pelestarian keanekaragaman hayati dan perlindungan habitat primer.' },
                { badge: 'PILAR 02', title: 'Penegakan Hukum', description: 'Integrasi pemantauan satelit radar dan patroli lapangan tanpa kompromi.' },
                { badge: 'PILAR 03', title: 'Pemberdayaan Adat', description: 'Pengakuan hak teritorial dan insentif pendanaan karbon terverifikasi.' }
            ]);

    const cardWidth = 2.65 + getRandomOffset(currentNum * 300, 0.05);
    const cardGap = 0.22 + getRandomOffset(currentNum * 301, 0.03);
    const startX = 0.8 + getRandomOffset(currentNum * 302, 0.03);
    const cardY = 1.65 + getRandomOffset(currentNum * 303, 0.02);
    const cardH = 3.3 + getRandomOffset(currentNum * 304, 0.03);

    cards.forEach((card, i) => {
        const x = startX + i * (cardWidth + cardGap);

        // Card Container - varied radius and fill
        const rectRadius = 0.12 + (i % 2) * 0.03;
        slide.addShape(pres.ShapeType.roundRect, {
            x: x + getRandomOffset(currentNum * 310 + i, 0.02),
            y: cardY,
            w: cardWidth,
            h: cardH,
            rectRadius: rectRadius,
            fill: { color: C.cardBg },
            line: { color: C.cardBorder, width: 1 }
        });

        // Card Badge - varied position
        slide.addText((card.badge || `PILAR 0${i + 1}`).toUpperCase(), {
            x: x + 0.15 + getRandomOffset(currentNum * 320 + i, 0.02),
            y: cardY + 0.18,
            w: cardWidth - 0.3,
            h: 0.25,
            fontSize: 8.5,
            bold: true,
            color: C.accentGreen,
            charSpacing: 1,
            fontFace: 'Arial'
        });

        // Card Title - varied position
        slide.addText(card.title || 'Judul Analisis', {
            x: x + 0.15 + getRandomOffset(currentNum * 330 + i, 0.02),
            y: cardY + 0.45,
            w: cardWidth - 0.3,
            h: 0.55,
            fontSize: 12.5,
            bold: true,
            color: C.textWhite,
            fontFace: 'Arial',
            wrap: true,
            valign: 'top',
            shrinkText: true,
            autoFit: true
        });

        // Card Description - varied position
        const cleanDesc = (card.description || '').substring(0, 150);
        slide.addText(cleanDesc, {
            x: x + 0.15 + getRandomOffset(currentNum * 340 + i, 0.02),
            y: cardY + 1.05,
            w: cardWidth - 0.3,
            h: 2.1,
            fontSize: 9.5,
            color: C.textMint,
            fontFace: 'Arial',
            wrap: true,
            valign: 'top',
            lineSpacingMultiple: 1.15,
            shrinkText: true,
            autoFit: true
        });
    });
}

/**
 * Slide Layout 5: Stat Highlight (Metric + Insight + Image) - Dynamic positions
 */
function renderStatHighlightSlide(pres, slide, s, currentNum, totalNum, C) {
    renderSlideHeader(pres, slide, s, currentNum, totalNum, C, 8.4);

    const hasImage = Boolean(s.imageUrl);

    // Dynamic base positions
    const baseX = 0.8 + getRandomOffset(currentNum * 400, 0.05);
    const baseY = 1.65 + getRandomOffset(currentNum * 401, 0.03);

    // Left Metric Box
    const metricW = (hasImage ? 2.6 : 3.2) + getRandomOffset(currentNum * 402, 0.04);
    slide.addShape(pres.ShapeType.roundRect, {
        x: baseX,
        y: baseY,
        w: metricW,
        h: 3.25,
        rectRadius: 0.15 + getRandomOffset(currentNum * 403, 0.02),
        fill: { color: C.cardGreen },
        line: { color: C.accentGreen, width: 1 }
    });

    slide.addText(s.keyMetric || '85%', {
        x: baseX + 0.1 + getRandomOffset(currentNum * 404, 0.02),
        y: baseY + 0.45 + getRandomOffset(currentNum * 405, 0.03),
        w: metricW - 0.2,
        h: 1.1,
        fontSize: hasImage ? 38 : 46,
        bold: true,
        color: C.textWhite,
        align: 'center',
        fontFace: 'Arial',
        shrinkText: true,
        autoFit: true
    });

    slide.addText(s.metricLabel || 'Metrik Terukur', {
        x: baseX + 0.1 + getRandomOffset(currentNum * 406, 0.02),
        y: baseY + 1.65 + getRandomOffset(currentNum * 407, 0.03),
        w: metricW - 0.2,
        h: 0.8,
        fontSize: 11,
        color: C.textMint,
        align: 'center',
        fontFace: 'Arial',
        wrap: true,
        shrinkText: true,
        autoFit: true
    });

    // Middle Insight Box
    const middleX = baseX + metricW + 0.2 + getRandomOffset(currentNum * 408, 0.02);
    const middleW = (hasImage ? 3.0 : 5.0) + getRandomOffset(currentNum * 409, 0.03);

    slide.addShape(pres.ShapeType.roundRect, {
        x: middleX,
        y: baseY,
        w: middleW,
        h: 3.25,
        rectRadius: 0.15 + getRandomOffset(currentNum * 410, 0.02),
        fill: { color: C.cardBg },
        line: { color: C.cardBorder, width: 1 }
    });

    const textItems = formatPointsToTextItems(s, C);
    slide.addText(textItems, {
        x: middleX + 0.15 + getRandomOffset(currentNum * 411, 0.02),
        y: baseY + 0.1 + getRandomOffset(currentNum * 412, 0.02),
        w: middleW - 0.3,
        h: 3.05,
        valign: 'top',
        wrap: true,
        shrinkText: true,
        autoFit: true,
        margin: [0.04, 0.04, 0.04, 0.04]
    });

    // Right Supporting Image
    if (hasImage) {
        const imageX = middleX + middleW + 0.2 + getRandomOffset(currentNum * 413, 0.02);
        const imageW = 2.4 + getRandomOffset(currentNum * 414, 0.03);

        slide.addShape(pres.ShapeType.roundRect, {
            x: imageX,
            y: baseY,
            w: imageW,
            h: 3.25,
            rectRadius: 0.15 + getRandomOffset(currentNum * 415, 0.02),
            fill: { color: C.cardBg },
            line: { color: C.cardBorder, width: 1 }
        });

        tryAddImage(slide, s.imageUrl, {
            x: imageX + getRandomOffset(currentNum * 416, 0.01),
            y: baseY,
            w: imageW,
            h: 3.25,
            rounding: true
        });
    }
}

/**
 * Slide Layout 6: Conclusion Slide
 */
function renderConclusionSlide(pres, slide, s, currentNum, totalNum, C) {
    renderSlideHeader(pres, slide, s, currentNum, totalNum, C, 8.4);

    slide.addShape(pres.ShapeType.roundRect, {
        x: 0.8,
        y: 1.65,
        w: 8.4,
        h: 3.25,
        rectRadius: 0.15,
        fill: { color: C.cardBg },
        line: { color: C.cardBorder, width: 1 }
    });

    const points = s.points && s.points.length ? s.points.slice(0, 3) : (s.bullets || []).slice(0, 3);
    const textItems = [];

    points.forEach((p, idx) => {
        const headline = typeof p === 'object' ? p.headline : `Langkah ${idx + 1}`;
        const rawDesc = typeof p === 'object' ? p.description : String(p).replace(/\*\*/g, '');
        const desc = rawDesc.substring(0, 150);

        textItems.push({
            text: `0${idx + 1}.  ${headline}\n`,
            options: {
                fontSize: 11,
                bold: true,
                color: C.accentGold,
                fontFace: 'Arial',
                spaceAfter: 2
            }
        });
        textItems.push({
            text: `${desc}${idx < points.length - 1 ? '\n\n' : ''}`,
            options: {
                fontSize: 9.5,
                color: C.textWhite,
                fontFace: 'Arial',
                lineSpacingMultiple: 1.15,
                spaceAfter: idx < points.length - 1 ? 6 : 0
            }
        });
    });

    slide.addText(textItems, {
        x: 1.1,
        y: 1.8,
        w: 7.8,
        h: 2.95,
        valign: 'top',
        wrap: true,
        shrinkText: true,
        autoFit: true,
        margin: [0.04, 0.04, 0.04, 0.04]
    });
}

/**
 * Fallback: Bullet List Slide (renders 3 distinct cards or 2 columns if no image to prevent overflow) - Dynamic
 */
function renderBulletListSlide(pres, slide, s, currentNum, totalNum, C) {
    const points = s.points && s.points.length ? s.points : [];

    // If 3 points exist, render as 3 horizontal cards (prevents giant vertical overflow)
    if (points.length === 3) {
        renderCardGrid3(pres, slide, {
            ...s,
            cards: points.map((p, i) => ({
                badge: `POIN 0${i + 1}`,
                title: p.headline,
                description: p.description
            }))
        }, currentNum, totalNum, C);
        return;
    }

    // Default container card - dynamic positioning
    renderSlideHeader(pres, slide, s, currentNum, totalNum, C, 8.4);

    const cardX = 0.8 + getRandomOffset(currentNum * 500, 0.03);
    const cardY = 1.65 + getRandomOffset(currentNum * 501, 0.02);

    slide.addShape(pres.ShapeType.roundRect, {
        x: cardX,
        y: cardY,
        w: 8.4 + getRandomOffset(currentNum * 502, 0.02),
        h: 3.25,
        rectRadius: 0.15 + getRandomOffset(currentNum * 503, 0.02),
        fill: { color: C.cardBg },
        line: { color: C.cardBorder, width: 1 }
    });

    const textItems = formatPointsToTextItems(s, C);
    slide.addText(textItems, {
        x: cardX + 0.3 + getRandomOffset(currentNum * 504, 0.02),
        y: cardY + 0.15 + getRandomOffset(currentNum * 505, 0.02),
        w: 7.8,
        h: 2.95,
        valign: 'top',
        wrap: true,
        shrinkText: true,
        autoFit: true,
        margin: [0.04, 0.04, 0.04, 0.04]
    });
}

/**
 * Fallback: Two Column Slide - Dynamic positions
 */
function renderTwoColumnSlide(pres, slide, s, currentNum, totalNum, C) {
    renderSlideHeader(pres, slide, s, currentNum, totalNum, C, 8.4);

    const colOne = s.columnOne || { heading: 'Pilar Utama', points: s.bullets?.slice(0, 2) || [] };
    const colTwo = s.columnTwo || { heading: 'Rencana Eksekusi', points: s.bullets?.slice(2) || [] };

    const cardY = 1.65 + getRandomOffset(currentNum * 600, 0.03);
    const cardW = 4.05 + getRandomOffset(currentNum * 601, 0.04);
    const cardH = 3.25 + getRandomOffset(currentNum * 602, 0.03);
    const cardGap = 0.3 + getRandomOffset(currentNum * 603, 0.03);
    const leftX = 0.8 + getRandomOffset(currentNum * 604, 0.03);
    const rightX = leftX + cardW + cardGap;

    // Column 1 Card
    slide.addShape(pres.ShapeType.roundRect, {
        x: leftX,
        y: cardY,
        w: cardW,
        h: cardH,
        rectRadius: 0.15 + getRandomOffset(currentNum * 605, 0.02),
        fill: { color: C.cardBg },
        line: { color: C.cardBorder, width: 1 }
    });

    slide.addText(colOne.heading || 'Pilar Utama', {
        x: leftX + 0.2 + getRandomOffset(currentNum * 606, 0.02),
        y: cardY + 0.15 + getRandomOffset(currentNum * 607, 0.02),
        w: cardW - 0.4,
        h: 0.35,
        fontSize: 13,
        bold: true,
        color: C.textMint,
        fontFace: 'Arial',
        shrinkText: true
    });

    const points1 = (colOne.points || []).map(p => ({
        text: p,
        options: {
            bullet: { type: 'bullet', code: '2022', color: C.textMint },
            fontSize: 9.5,
            color: C.textWhite,
            breakLine: true,
            spaceAfter: 6,
            fontFace: 'Arial'
        }
    }));

    slide.addText(points1, {
        x: leftX + 0.2 + getRandomOffset(currentNum * 608, 0.02),
        y: cardY + 0.55 + getRandomOffset(currentNum * 609, 0.02),
        w: cardW - 0.4,
        h: cardH - 0.75,
        valign: 'top',
        wrap: true,
        shrinkText: true,
        autoFit: true
    });

    // Column 2 Card
    slide.addShape(pres.ShapeType.roundRect, {
        x: rightX,
        y: cardY + getRandomOffset(currentNum * 610, 0.02),
        w: cardW,
        h: cardH,
        rectRadius: 0.15 + getRandomOffset(currentNum * 611, 0.02),
        fill: { color: C.cardBg },
        line: { color: C.cardBorder, width: 1 }
    });

    slide.addText(colTwo.heading || 'Rencana Eksekusi', {
        x: rightX + 0.2 + getRandomOffset(currentNum * 612, 0.02),
        y: cardY + 0.15 + getRandomOffset(currentNum * 613, 0.02),
        w: cardW - 0.4,
        h: 0.35,
        fontSize: 13,
        bold: true,
        color: C.textMint,
        fontFace: 'Arial',
        shrinkText: true
    });

    const points2 = (colTwo.points || []).map(p => ({
        text: p,
        options: {
            bullet: { type: 'bullet', code: '2022', color: C.textMint },
            fontSize: 9.5,
            color: C.textWhite,
            breakLine: true,
            spaceAfter: 6,
            fontFace: 'Arial'
        }
    }));

    slide.addText(points2, {
        x: rightX + 0.2 + getRandomOffset(currentNum * 614, 0.02),
        y: cardY + 0.55 + getRandomOffset(currentNum * 615, 0.02),
        w: cardW - 0.4,
        h: cardH - 0.75,
        valign: 'top',
        wrap: true,
        shrinkText: true,
        autoFit: true
    });
}

/**
 * Format structured points or bullets into formatted PptxGenJS text chunks
 * with strict length and line-spacing optimization to prevent slide overflow.
 */
function formatPointsToTextItems(s, C) {
    const textItems = [];
    const points = s.points && s.points.length ? s.points.slice(0, 3) : [];

    if (points.length > 0) {
        points.forEach((p, idx) => {
            if (p.headline) {
                textItems.push({
                    text: `${p.headline}\n`,
                    options: {
                        fontSize: 11,
                        bold: true,
                        color: C.textMint,
                        fontFace: 'Arial',
                        spaceAfter: 2
                    }
                });
            }
            if (p.description) {
                // Truncate to maximum 180 chars to strictly prevent PowerPoint bounding box overflow
                const cleanDesc = p.description.trim().substring(0, 180);
                textItems.push({
                    text: `${cleanDesc}${idx < points.length - 1 ? '\n\n' : ''}`,
                    options: {
                        fontSize: 9.5,
                        color: C.textWhite,
                        fontFace: 'Arial',
                        lineSpacingMultiple: 1.15,
                        spaceAfter: idx < points.length - 1 ? 6 : 0
                    }
                });
            }
        });
    } else if (s.bullets && Array.isArray(s.bullets)) {
        s.bullets.slice(0, 3).forEach(b => {
            textItems.push({
                text: b.substring(0, 160),
                options: {
                    bullet: { type: 'bullet', code: '2022', color: C.textMint },
                    fontSize: 9.5,
                    color: C.textWhite,
                    breakLine: true,
                    spaceAfter: 6,
                    fontFace: 'Arial'
                }
            });
        });
    }

    return textItems.length ? textItems : [{ text: 'Poin analisis strategi terstruktur.', options: { fontSize: 10, color: C.textWhite } }];
}

/**
 * Helper to safely embed remote image into PPTX slide
 */
function tryAddImage(slide, url, options) {
    if (!url) return false;
    try {
        slide.addImage({
            path: url,
            ...options
        });
        return true;
    } catch (err) {
        console.warn('[PptxGen] Could not embed image into slide:', err.message);
        return false;
    }
}

/**
 * Common Slide Header Component
 */
function renderSlideHeader(pres, slide, s, currentNum, totalNum, C, contentWidth = 7.4) {
    renderSlideHeaderCustom(pres, slide, s, currentNum, totalNum, C, 0.8, contentWidth);
}

function renderSlideHeaderCustom(pres, slide, s, currentNum, totalNum, C, startX, contentWidth) {
    // Top Badge Pill
    slide.addText((s.badge || 'ANALISIS').toUpperCase(), {
        x: startX,
        y: 0.45,
        w: contentWidth,
        h: 0.22,
        fontSize: 8.5,
        color: C.textMuted,
        bold: true,
        charSpacing: 1.5,
        fontFace: 'Arial'
    });

    // Dynamic Title Font Size based on length
    const titleText = s.title || 'Slide Title';
    const titleFontSize = titleText.length > 55 ? 15 : (titleText.length > 35 ? 17 : 19);

    slide.addText(titleText, {
        x: startX,
        y: 0.68,
        w: contentWidth,
        h: 0.55,
        fontSize: titleFontSize,
        bold: true,
        color: C.textWhite,
        fontFace: 'Arial',
        valign: 'top',
        wrap: true,
        shrinkText: true,
        autoFit: true
    });

    // Slide Subtitle if any
    if (s.subtitle) {
        slide.addText(s.subtitle, {
            x: startX,
            y: 1.25,
            w: contentWidth,
            h: 0.28,
            fontSize: 10,
            color: C.textMuted,
            fontFace: 'Arial',
            valign: 'top',
            wrap: true,
            shrinkText: true,
            autoFit: true
        });
    }

    // Slide Number at top right
    slide.addText(`${String(currentNum).padStart(2, '0')} / ${String(totalNum).padStart(2, '0')}`, {
        x: 8.2,
        y: 0.45,
        w: 1.0,
        h: 0.25,
        fontSize: 9.5,
        color: C.textMuted,
        align: 'right',
        bold: true,
        fontFace: 'Arial'
    });

    // Bottom Footer Line
    slide.addShape(pres.ShapeType.line, {
        x: 0.8,
        y: 5.1,
        w: 8.4,
        h: 0,
        line: { color: C.cardBorder, width: 0.5 }
    });

    slide.addText('FlyPtx AI Agent • Presentation Intelligence', {
        x: 0.8,
        y: 5.2,
        w: 5.0,
        h: 0.25,
        fontSize: 8.5,
        color: C.textMuted,
        fontFace: 'Arial'
    });
}
