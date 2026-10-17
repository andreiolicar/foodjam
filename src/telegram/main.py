import telebot
import os
from dotenv import load_dotenv

load_dotenv()

bot_token = os.getenv("TELEGRAM_BOT_TOKEN")

bot = telebot.TeleBot(bot_token)

@bot.message_handler(['start'])
def start(msg:telebot.types.Message):
    bot.reply_to(msg, 'Hello, world!')


bot.infinity_polling()