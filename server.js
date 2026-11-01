require('dotenv').config();

const { PORT, MONGODB_URI } = require('./src/server/config');
const { connectToDatabase } = require('./src/server/database');
const { createApp } = require('./src/server/createApp');

const app = createApp();

connectToDatabase(MONGODB_URI);
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
