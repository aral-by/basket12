const express = require('express');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Aktif maçları tutmak için Map
const activeMatches = new Map();

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Maç analiz sayfası
app.get('/match-analysis', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'match-analysis.html'));
});

// Maç durumu kontrolü
async function checkMatchStatus(matchId) {
    const match = activeMatches.get(matchId);
    if (!match) {
        console.log('Match not found in activeMatches:', matchId);
        return null;
    }

    try {
        const browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920x1080',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log('Loading match URL:', match.url);
        await page.goto(match.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Maç durumunu kontrol et
        const matchData = await page.evaluate(() => {
            try {
                // Periyot kontrolü
                const periodXPath = '//*[@id="detail"]/div[3]/div[1]/div[3]/div/div[2]/span[1]';
                const periodResult = document.evaluate(periodXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const periodElement = periodResult.singleNodeValue;
                const period = periodElement ? periodElement.textContent.trim() : '';

                // Skor kontrolü
                const homeScoreXPath = '//*[@id="detail"]/div[3]/div[1]/div[3]/div/div[1]/span[1]';
                const awayScoreXPath = '//*[@id="detail"]/div[3]/div[1]/div[3]/div/div[1]/span[3]';
                
                const homeScoreResult = document.evaluate(homeScoreXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const awayScoreResult = document.evaluate(awayScoreXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                
                const homeScore = homeScoreResult.singleNodeValue ? homeScoreResult.singleNodeValue.textContent.trim() : '0';
                const awayScore = awayScoreResult.singleNodeValue ? awayScoreResult.singleNodeValue.textContent.trim() : '0';

                // Takım isimleri
                const homeTeam = document.querySelector('.duelParticipant__home .participant__participantName')?.textContent.trim() || 'Ev Sahibi';
                const awayTeam = document.querySelector('.duelParticipant__away .participant__participantName')?.textContent.trim() || 'Deplasman';

                return {
                    period,
                    homeScore,
                    awayScore,
                    homeTeam,
                    awayTeam,
                    matchStarted: period.includes('Quarter') || /\d/.test(homeScore) || /\d/.test(awayScore)
                };
            } catch (error) {
                console.error('Error in page evaluation:', error);
                return null;
            }
        });

        await browser.close();

        if (!matchData) {
            return {
                status: 'Bekleniyor',
                lastChecked: new Date().toISOString()
            };
        }

        return {
            homeTeam: matchData.homeTeam,
            awayTeam: matchData.awayTeam,
            homeScore: matchData.homeScore,
            awayScore: matchData.awayScore,
            period: matchData.period,
            status: matchData.period || 'Maç Devam Ediyor',
            lastChecked: new Date().toISOString()
        };

    } catch (error) {
        console.error('Error checking match status:', error);
        return null;
    }
}

// Form gönderimi
app.post('/submit', async (req, res) => {
    const matchUrl = req.body.matchUrl;
    const matchId = Date.now().toString();
    
    activeMatches.set(matchId, { url: matchUrl, lastChecked: new Date() });
    
    const initialMatchData = await checkMatchStatus(matchId);
    if (initialMatchData) {
        if (initialMatchData.status && initialMatchData.status.includes('Quarter')) {
            return res.redirect(`/match-analysis?matchId=${matchId}&status=started`);
        } else {
            return res.redirect(`/match-analysis?matchId=${matchId}&status=waiting`);
        }
    }
    
    res.redirect(`/match-analysis?matchId=${matchId}&status=waiting`);
});

// Maç durumu endpoint'i
app.get('/match-status/:matchId', async (req, res) => {
    const matchId = req.params.matchId;
    const matchData = await checkMatchStatus(matchId);
    res.json(matchData || { status: 'Bekleniyor', lastChecked: new Date().toISOString() });
});

// Her dakika maç durumunu kontrol et
cron.schedule('* * * * *', async () => {
    for (const [matchId, match] of activeMatches) {
        console.log(`Checking match ${matchId}...`);
        const matchData = await checkMatchStatus(matchId);
        if (matchData) {
            console.log(`Match ${matchId} status:`, matchData.status);
        }
    }
});

// Sunucuyu başlat
app.listen(port, () => {
    console.log(`Uygulama http://localhost:${port} adresinde çalışıyor`);
}); 