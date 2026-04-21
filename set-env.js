const fs = require('fs');

// Path where the file will be created on the Vercel server
const targetPath = './src/environments/environment.prod.ts';

// This text uses "process.env" to grab secrets from Vercel's settings
const envConfigFile = `
export const environment = {
  production: true,
  apiKey: '${process.env.FIREBASE_API_KEY}',
  authDomain: '${process.env.FIREBASE_AUTH_DOMAIN}',
  projectId: '${process.env.FIREBASE_PROJECT_ID}',
  storageBucket: '${process.env.FIREBASE_STORAGE_BUCKET}',
  messagingSenderId: '${process.env.FIREBASE_MESSAGING_SENDER_ID}',
  appId: '${process.env.FIREBASE_APP_ID}',
  twilioAccountSid: '${process.env.TWILIO_ACCOUNT_SID}',
  twilioAuthToken: '${process.env.TWILIO_AUTH_TOKEN}',
  twilioFromNumber: '${process.env.TWILIO_FROM_NUMBER}',
  twiliotemplatesid: '${process.env.TWILIO_TEMPLATE_ID}'
};
`;

fs.writeFileSync(targetPath, envConfigFile);
console.log('Environment file generated successfully!');