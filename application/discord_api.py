import os
import discord
from discord.ext import commands
from dotenv import load_dotenv
from application.openai import chatgpt_response
import requests

# Load environment variables
load_dotenv()

# Initialize Discord bot with necessary intents
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

# Dictionary to store conversations by channel and discord user
channel_conversations = {}

# Define global API base URL
api_base_url = "http://api-application:5000"
if not api_base_url:
    print("No API_BASE_URL found in environment.")
    exit(1)  # Terminate if API base URL is not set

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user}')
    print('Bot is ready and retrieving past conversations.')

    # Load previous conversations for the specified channel IDs
    channel_ids = os.getenv("DISCORD_CHANNEL_IDS")
    if not channel_ids:
        print("No DISCORD_CHANNEL_IDS found in environment.")
        return

    channel_ids = channel_ids.split(",")

    for channel_id in channel_ids:
        try:
            print(f"Attempting to load previous conversations for channel {channel_id.strip()}")
            response = requests.get(f"{api_base_url}/getConversation/{channel_id.strip()}")
            response.raise_for_status()
            conversation = response.json()

            # Ensure the retrieved conversation data is properly structured
            if "conversations" in conversation and isinstance(conversation["conversations"], list):
                channel_conversations[channel_id.strip()] = conversation["conversations"]
                print(f"Loaded conversation for channel {channel_id}: {channel_conversations[channel_id.strip()]}")
            else:
                print(f"No valid conversation found for channel {channel_id}.")
        except requests.exceptions.RequestException as e:
            print(f"Failed to load conversation for channel {channel_id}: {e}")

@bot.event
async def on_message(message):
    if message.author == bot.user:
        return  # Avoid replying to itself

    channel_id = str(message.channel.id)
    discord_id = str(message.author.id)

    # Ensure previous context is loaded before generating a response
    if channel_id not in channel_conversations:
        try:
            print(f"Attempting to load previous context for channel {channel_id} and user {discord_id}")
            response = requests.get(f"{api_base_url}/getConversation/{discord_id}/{channel_id}")
            response.raise_for_status()
            conversation = response.json()
            if "conversations" in conversation and isinstance(conversation["conversations"], list):
                # Update the cache
                channel_conversations[channel_id] = conversation["conversations"]
                print(f"Loaded conversation for channel {channel_id} and user {discord_id}: {channel_conversations[channel_id]}")
            else:
                print(f"No valid conversation found for channel {channel_id} and user {discord_id}.")
        except requests.exceptions.RequestException as e:
            print(f"Failed to load conversation for channel {channel_id} and user {discord_id}: {e}")

    # Generate the previous context if available
    previous_context = ""
    if channel_id in channel_conversations and channel_conversations[channel_id]:
        print(f"Building previous context for conversation in channel {channel_id}")
        # Only include the most recent 5 exchanges to avoid overwhelming the prompt
        conversation_entries = channel_conversations[channel_id][-1]['entries'][-5:]
        for entry in conversation_entries:
            user_message = entry.get('userMessage', '')
            bot_response = entry.get('botResponse', '')
            if user_message and bot_response:
                previous_context += f"User: {user_message}\nBot: {bot_response}\n"

        # Debug: print the context being used
        print(f"Previous context: {previous_context}")

    # Generate response using OpenAI API
    prompt = f"{previous_context}\nUser: {message.content}\nBot:"
    print(f"Prompt being sent to OpenAI: {prompt}")
    response = chatgpt_response(prompt)

    await message.channel.send(response)

    # Save the new conversation by calling your API
    data = {
        "discordId": discord_id,
        "channelId": channel_id,
        "userMessage": message.content,
        "botResponse": response,
    }
    headers = {"Content-Type": "application/json"}
    api_endpoint = f"{api_base_url}/saveConversation"

    try:
        print(f"Attempting to save conversation data: {data}")
        save_response = requests.post(api_endpoint, json=data, headers=headers)
        save_response.raise_for_status()
        print(f"Conversation saved successfully: {save_response.status_code}, content: {save_response.text}")

        # Update local cache with the new entry
        if channel_id in channel_conversations:
            channel_conversations[channel_id][-1]['entries'].append({
                "userMessage": message.content,
                "botResponse": response,
                "timestamp": message.created_at.isoformat()
            })
        else:
            channel_conversations[channel_id] = [{
                "date": message.created_at.strftime("%Y-%m-%d"),
                "entries": [{
                    "userMessage": message.content,
                    "botResponse": response,
                    "timestamp": message.created_at.isoformat()
                }]
            }]
    except requests.exceptions.RequestException as e:
        print(f"Failed to save conversation: {e}")

# Start the bot
print("Loading token...")
token = os.getenv("DISCORD_TOKEN")
if not token:
    print("Error: DISCORD_TOKEN is not set.")
else:
    print("Starting bot...")
    bot.run(token)
