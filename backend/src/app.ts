import express from 'express';
import cors from 'cors';
import reservationsRouter from './api/routes/reservations';
import { errorHandler } from './api/middleware/errorHandler';
import { requestLogger } from './api/middleware/requestLogger';

const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());
app.use(requestLogger);

app.get('/', (_req, res) => {
  res.send('Iron Booking API is running 🚀');
});

app.use('/api/v1/reservations', reservationsRouter);

app.use(errorHandler);

export default app;
