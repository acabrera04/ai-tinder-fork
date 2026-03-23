require('dotenv').config();
const express = require('express');
const { generalLimiter } = require('./middleware/rateLimit');

const app = express();

app.use(express.json());
app.use(generalLimiter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/swipes', require('./routes/swipes'));
app.use('/api/push', require('./routes/push'));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`AI Tinder backend listening on port ${PORT}`));
}

module.exports = app;
