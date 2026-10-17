import telebot
from config import TELEGRAM_BOT_TOKEN
from handlers import register_handlers


def main():
    bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)

    register_handlers(bot)

    print("Bot iniciado!")
    bot.infinity_polling()


if __name__ == "__main__":
    main()