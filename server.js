const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const GOLD_URL = 'https://www.goodreturns.in/gold-rates/trichy.html';
const SILVER_URL = 'https://www.goodreturns.in/silver-rates/trichy.html';

app.get('/rates', async (req, res) => {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0' },
        timeout: 8000
    };
    try {
        const [gRes, sRes] = await Promise.all([axios.get(GOLD_URL, config), axios.get(SILVER_URL, config)]);
        const $g = cheerio.load(gRes.data);
        const $s = cheerio.load(sRes.data);

        const parseRates = ($) => {
            const table = $('table').first();
            const today = parseFloat(table.find('tr').eq(1).find('td').eq(1).text().replace(/[^\d.]/g, ''));
            const yesterday = parseFloat(table.find('tr').eq(1).find('td').eq(2).text().replace(/[^\d.]/g, ''));
            return { today, yesterday, change: (today - yesterday) };
        };

        const gold = parseRates($g);
        const silver = parseRates($s);

        res.json({
            date: "2 March 2026",
            location: "Trichy, Tamil Nadu",
            gold: { buy: gold.today, sell: Math.round(gold.today * 0.97), yesterday: gold.yesterday, mktChange: gold.change },
            silver: { buy: silver.today, sell: Math.round(silver.today * 0.97), yesterday: silver.yesterday, mktChange: silver.change },
            ratio: (gold.today / silver.today).toFixed(2),
            ratioYesterday: (gold.yesterday / silver.yesterday).toFixed(2)
        });
    } catch (error) {
        res.json({
            date: "2 March 2026", location: "Trichy, TN (Offline)",
            gold: { buy: 17084, sell: 16571, yesterday: 17209, mktChange: -125 },
            silver: { buy: 315, sell: 305, yesterday: 325, mktChange: -10 },
            ratio: "54.23", ratioYesterday: "52.95"
        });
    }
});

app.listen(3000, () => console.log('Portfolio Server: http://localhost:3000'));