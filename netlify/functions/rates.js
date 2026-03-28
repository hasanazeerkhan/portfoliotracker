const axios = require('axios');
const cheerio = require('cheerio');

const SOURCE_BASE = 'https://www.goodreturns.in';
const GOLD_URL = `${SOURCE_BASE}/gold-rates/trichy.html`;
const SILVER_URL = `${SOURCE_BASE}/silver-rates/trichy.html`;
const RATIO_BASELINE = 62;

const FALLBACK = {
    gold: { price: 17084, prevClose: 17209, change: -125 },
    silver: { price: 315, prevClose: 325, change: -10 }
};

const numberFromText = (value) => {
    const parsed = Number.parseFloat(String(value || '').replace(/[^\d.]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const normalizePerGram = (rawPrice, referencePerGram) => {
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;
    if (!Number.isFinite(referencePerGram) || referencePerGram <= 0) {
        return Number(rawPrice.toFixed(2));
    }

    let best = rawPrice;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let shift = -4; shift <= 6; shift += 1) {
        const candidate = rawPrice * Math.pow(10, shift);
        if (!(candidate > 0)) continue;
        const score = Math.abs(Math.log10(candidate / referencePerGram));
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }

    return Number(best.toFixed(2));
};

const buildRatio = (goldPrice, silverPrice) => {
    if (!(goldPrice > 0) || !(silverPrice > 0)) {
        return { current: '0.00', deviation: '0.0' };
    }
    const current = goldPrice / silverPrice;
    const deviation = ((current - RATIO_BASELINE) / RATIO_BASELINE) * 100;
    return {
        current: current.toFixed(2),
        deviation: deviation.toFixed(1)
    };
};

const buildStrategy = (ratioValue) => {
    if (ratioValue < 60) {
        return {
            advice: 'BUY GOLD',
            explanation: 'Gold looks cheaper now. You can buy slowly.'
        };
    }

    if (ratioValue > 80) {
        return {
            advice: 'BUY SILVER',
            explanation: 'Silver looks cheaper now. You can buy slowly.'
        };
    }

    return {
        advice: 'BALANCED',
        explanation: 'Prices look balanced now. Hold or buy both slowly.'
    };
};

const normalizeDate = (raw) => {
    if (!raw) return null;
    const parsed = new Date(raw.replace(/(\d{1,2})(st|nd|rd|th)/gi, '$1'));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
};

const extractDateFromText = (text) => {
    if (!text) return null;
    const patterns = [
        /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/,
        /\b[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\b/,
        /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const normalized = normalizeDate(match[0]);
            if (normalized) return normalized;
        }
    }
    return null;
};

const parseHistoricalRates = ($, referencePerGram) => {
    const byDate = new Map();

    $('table tr').each((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length < 2) return;

        const rowText = $(tr).text().replace(/\s+/g, ' ').trim();
        const date = extractDateFromText(rowText);
        if (!date) return;

        let price = null;
        for (let i = 1; i < tds.length; i += 1) {
            const n = numberFromText($(tds[i]).text());
            if (n !== null) {
                price = n;
                break;
            }
        }
        if (price !== null && !byDate.has(date)) {
            const normalized = normalizePerGram(price, referencePerGram);
            if (normalized !== null) {
                byDate.set(date, normalized);
            }
        }
    });

    return Array.from(byDate.entries())
        .map(([date, price]) => ({ date, price }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-7);
};

const buildHistory7 = (goldHistory, silverHistory) => {
    const silverMap = new Map(silverHistory.map((d) => [d.date, d.price]));
    return goldHistory
        .filter((d) => silverMap.has(d.date))
        .map((d) => ({
            date: d.date,
            gold: d.price,
            silver: silverMap.get(d.date)
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-7);
};

const buildPayload = (gold, silver, source, history7 = [], historyIsExact = false, error = null) => {
    const ratio = buildRatio(gold.price, silver.price);
    const numericRatio = Number.parseFloat(ratio.current) || 0;
    const strategy = buildStrategy(numericRatio);
    const now = new Date();

    return {
        date: now.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }),
        asOfIso: now.toISOString(),
        source,
        gold,
        silver,
        ratio,
        strategy,
        history7,
        historyIsExact,
        ...(error ? { error } : {})
    };
};

const parseRates = ($) => {
    const table = $('table').first();
    const today = numberFromText(table.find('tr').eq(1).find('td').eq(1).text());
    const yesterday = numberFromText(table.find('tr').eq(1).find('td').eq(2).text());

    if (today === null || yesterday === null) {
        throw new Error('Unable to parse rates from source table');
    }

    return { price: today, prevClose: yesterday, change: today - yesterday };
};

exports.handler = async (event, context) => {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' },
        timeout: 8000
    };

    try {
        const [gRes, sRes] = await Promise.all([
            axios.get(GOLD_URL, config),
            axios.get(SILVER_URL, config)
        ]);

        const $g = cheerio.load(gRes.data);
        const $s = cheerio.load(sRes.data);
        const gold = parseRates($g);
        const silver = parseRates($s);
        const goldHistory = parseHistoricalRates($g, gold.price);
        const silverHistory = parseHistoricalRates($s, silver.price);
        const history7 = buildHistory7(goldHistory, silverHistory);
        const payload = buildPayload(gold, silver, 'live', history7, history7.length >= 4);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-store'
            },
            body: JSON.stringify(payload)
        };
    } catch (error) {
        const payload = buildPayload(
            FALLBACK.gold,
            FALLBACK.silver,
            'fallback',
            [],
            false,
            error instanceof Error ? error.message : 'Unknown error'
        );

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-store'
            },
            body: JSON.stringify(payload)
        };
    }
};
