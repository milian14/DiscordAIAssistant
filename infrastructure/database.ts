import { MongoClient, Db, Collection } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI || 'mongodb://mongo:27017/discordBotDB';

export const client = new MongoClient(uri);

let db: Db;
let collection: Collection<Conversation>;

// Conversation types
interface ConversationEntry {
  userMessage: string;
  botResponse: string;
  timestamp: Date;
}

interface DailyConversation {
  date: string;
  entries: ConversationEntry[];
}

interface Conversation {
  discordId: string;
  channelId: string;
  conversations: DailyConversation[];
}

// Connect to MongoDB with retry logic
export async function connectToDatabase(): Promise<void> {
  const maxRetries = 5;
  let retries = maxRetries;

  while (retries) {
    try {
      if (!db || !collection) {
        await client.connect();
        db = client.db('discordBotDB');
        collection = db.collection<Conversation>('conversations');
        console.log('Connected to MongoDB and initialized conversations collection');

        // Optionally create an index on `discordId` and `channelId` to optimize lookups
        await collection.createIndex({ discordId: 1, channelId: 1 });
      } else {
        console.log('MongoDB connection already established.');
      }
      break; // Exit loop if successful
    } catch (error) {
      retries -= 1;
      console.error(`Error connecting to MongoDB: ${(error as Error).message}. Retries left: ${retries}`);
      if (retries === 0) throw new Error('Failed to connect to MongoDB after multiple attempts');
      await new Promise((res) => setTimeout(res, 5000)); // Wait before retrying
    }
  }
}

// Save a conversation to MongoDB
export async function saveConversation(
  discordId: string,
  channelId: string,
  userMessage: string,
  botResponse: string
): Promise<void> {
  const timestamp = new Date();
  const date = timestamp.toISOString().split('T')[0]; // Format as YYYY-MM-DD
  const newEntry: ConversationEntry = { userMessage, botResponse, timestamp };

  try {
    const existingConversation = await collection.findOne({ discordId, channelId });

    if (existingConversation) {
      const existingDailyConversation = existingConversation.conversations.find(
        (conv: DailyConversation) => conv.date === date
      );

      if (existingDailyConversation) {
        await collection.updateOne(
          { discordId, channelId, 'conversations.date': date },
          { $push: { 'conversations.$.entries': newEntry } }
        );
      } else {
        await collection.updateOne(
          { discordId, channelId },
          { $push: { conversations: { date, entries: [newEntry] } } }
        );
      }
    } else {
      const newConversation: Conversation = {
        discordId,
        channelId,
        conversations: [{ date, entries: [newEntry] }],
      };
      await collection.insertOne(newConversation);
    }

    console.log('Conversation saved successfully.');
  } catch (error) {
    console.error('Error saving conversation:', (error as Error).message);
    throw new Error('Failed to save conversation');
  }
}

// Retrieve a user's conversation by Discord ID and Channel ID
export async function getUserConversation(
  discordId: string,
  channelId: string,
  date?: string
): Promise<Conversation | null> {
  try {
    const query = date
      ? { discordId, channelId, 'conversations.date': date }
      : { discordId, channelId };

    const projection = date ? { 'conversations.$': 1 } : undefined;
    const conversation = await collection.findOne(query, { projection });

    return conversation || null;
  } catch (error) {
    console.error('Error retrieving conversation:', (error as Error).message);
    throw new Error('Failed to retrieve conversation');
  }
}
