const fs = require('fs');

const config = {
  apiKey: process.env.VITE_TIRECONNECT_API_KEY || '',
};

const output = `window.EASTCORD_TIRECONNECT_CONFIG = ${JSON.stringify(config, null, 2)};\n`;

fs.writeFileSync('tireconnect-config.js', output);
