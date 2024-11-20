import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { connectToDatabase, saveConversation, getUserConversation, client } from '../infrastructure/database';
import rateLimit from 'express-rate-limit';  // Import for rate limiting

dotenv.config();

const requiredEnvVars = ['MONGODB_URI', 'PORT'];
requiredEnvVars.forEach((envVar) => {
    if (!process.env[envVar]) {
        console.error(`Environment variable ${envVar} is missing.`);
        process.exit(1);
    }
});

const app = express();
app.use(express.json());

const port = process.env.PORT || 5000;

// Connect to the database when the server starts
connectToDatabase();

// Middleware for validation
const validateConversationRequest = (req: Request, res: Response, next: NextFunction): void => {
    const { discordId, userMessage, botResponse } = req.body;

    if (!discordId || !userMessage || !botResponse) {
        res.status(400).json({ message: 'Missing required fields' });
        return;
    }

    next();
};

const validateDiscordIdParam = (req: Request, res: Response, next: NextFunction): void => {
    const { discordId } = req.params;

    if (!discordId || !/^\d+$/.test(discordId)) {
        res.status(400).json({ message: 'Invalid Discord ID' });
        return;
    }

    next();
};

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
    return (req: Request, res: Response, next: NextFunction): Promise<void> =>
        Promise.resolve(fn(req, res, next)).catch((err) => next(err));
};

app.use((err: any, _req: Request, res: Response, _next: Function) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

// Rate limiter middleware
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
});

// **Add this root route to handle requests to "/"**
app.get('/', (_req: Request, res: Response) => {
    res.send('Welcome to the DiscordAI Assistant API!');
});

// Endpoint to save a conversation
app.post('/saveConversation', apiLimiter, validateConversationRequest, asyncHandler(async (req: Request, res: Response) => {
    const { discordId, channelId, userMessage, botResponse } = req.body;
    await saveConversation(discordId, channelId, userMessage, botResponse);
    res.status(200).json({ message: 'Conversation saved successfully' });
}));

// Endpoint to get a conversation by Discord ID and Channel ID
app.get('/getConversation/:discordId/:channelId', validateDiscordIdParam, asyncHandler(async (req: Request, res: Response) => {
    const { discordId, channelId } = req.params;
    console.log(`Received request for discordId: ${discordId}, channelId: ${channelId}`);
    const conversation = await getUserConversation(discordId, channelId);

    if (!conversation) {
        console.log('Convo not found.');
        res.status(404).json({ message: 'Conversation not found.' });
    } else {
        console.log('Sending conversation data')
        res.status(200).json(conversation);
    }
}));


// Error handling middleware
app.use(
    (err: any, _req: Request, res: Response, _next: NextFunction): void => {
        console.error('Unhandled Error:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
);

// Start the server
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Graceful shutdown handling
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await client.close();
    server.close(() => process.exit(0));
});
