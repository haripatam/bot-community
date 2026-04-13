const { GoogleSpreadsheet } = require('google-spreadsheet');
const cron = require('node-cron');
const { JWT } = require('google-auth-library');

// Load Google credentials from env var (set in Northflank Secret Groups)
if (!process.env.GOOGLE_CREDS_JSON) throw new Error('GOOGLE_CREDS_JSON env var is missing!');
const creds = JSON.parse(process.env.GOOGLE_CREDS_JSON);

let cachedEvents = [];

function standardizeDateStr(val) {
    if (!val) return "";
    let d = new Date(val);
    
    if (isNaN(d.getTime())) {
        const parts = val.split(/[-/]/);
        if (parts.length === 3) {
            if (parts[2].length === 4) return `${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}-${parts[2]}`;
        }
        return val;
    }
    
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${day}-${mo}-${yr}`;
}

async function fetchSheetData() {
    console.log("Fetching new sheet data via Service Account...");
    try {
        if (!process.env.GOOGLE_SHEET_ID) return;

        const serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();

        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();

        const newEventsArray = [];
        
        // The first event is accidentally swallowed as headers by the library
        if (sheet.headerValues && sheet.headerValues.length > 0) {
            newEventsArray.push({
                Name: sheet.headerValues[0] || "Unnamed Event",
                Date: standardizeDateStr(sheet.headerValues[1]),
                Time: sheet.headerValues[2] || '',
                Location: sheet.headerValues[3] || '',
                Description: sheet.headerValues[4] || ''
            });
        }

        // Parse remaining rows using raw index columns instead of named keys
        rows.forEach(row => {
            const arr = row._rawData;
            if (!arr || arr.length < 2) return;
            
            newEventsArray.push({
                Name: arr[0] || "Unnamed Event",
                Date: standardizeDateStr(arr[1]),
                Time: arr[2] || '',
                Location: arr[3] || '',
                Description: arr[4] || ''
            });
        });

        cachedEvents = newEventsArray;
        console.log(`Rigid Cache Updated: ${cachedEvents.length} rows parsed`);

    } catch (err) {
        console.error("Failed to fetch sheet.", err);
    }
}

cron.schedule('0 8,11,15 * * *', () => { fetchSheetData(); });
fetchSheetData();

function getCurrentDateStr() {
    return standardizeDateStr(new Date());
}

function getEventsByDate(dateStr) {
    return cachedEvents.filter(e => e.Date === dateStr);
}

module.exports = { fetchSheetData, getCurrentDateStr, getEventsByDate };
