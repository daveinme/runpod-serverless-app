require('dotenv').config({ path: require('path').join(__dirname, '.env') });

module.exports = {
  RUNPOD_API_KEY: process.env.RUNPOD_API_KEY,
  ENDPOINTS: {
    image: process.env.ENDPOINT_IMAGE || '',
    video: process.env.ENDPOINT_VIDEO || '',
  },
  PORT: process.env.PORT || 3000,
  SESSION_SECRET: process.env.SESSION_SECRET,
  GOOGLE_CLIENT_ID: process.env.CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.CLIENT_SECRET,
  BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
};
