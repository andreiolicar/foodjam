import telebot

import collector
# from api_client import send_messages


def register_handlers(bot):

    @bot.message_handler(commands=["iniciar"])
    def start_collection(message):
        chat_id = message.chat.id

        if not collector.start(chat_id):
            bot.reply_to(message, "Já existe uma coleta ativa.")
            return

        bot.reply_to(
            message,
            "Coleta iniciada! As próximas messages serão registradas."
        )

    @bot.message_handler(commands=["finalizar"])
    def finish_collection(message):
        chat_id = message.chat.id
        messages = collector.finish(chat_id)

        if messages is None:
            bot.reply_to(message, "Não existe coleta ativa.")
            return

        if not messages:
            bot.reply_to(message, "Nenhuma mensagem foi coletada.")
            return

        try:
            # send_messages(chat_id, messages)
            print(chat_id)
            print(messages)
            bot.reply_to(
                message,
                "messages enviadas para processamento!"
            )

        except Exception:
            collector.restore(chat_id, messages)
            bot.reply_to(
                message,
                "Erro ao enviar os dados. A coleta foi restaurada."
            )

    @bot.message_handler(
        content_types=[
            "text", "photo", "document",
            "audio", "voice", "video"
        ]
    )
    def collect_message(message):
        chat_id = message.chat.id

        if not collector.is_active(chat_id):
            return

        # Não registra outros comandos como messages comuns
        if message.content_type == "text" and message.text.startswith("/"):
            return

        texto = message.text or message.caption or ""

        item = {
            "message_id": message.message_id,
            "user_id": (
                message.from_user.id if message.from_user else None
            ),
            "username": (
                message.from_user.username
                if message.from_user else None
            ),
            "date": message.date,
            "content_type": message.content_type,
            "text": texto,
        }

        # Identifica arquivos de mídia, sem baixá-los
        if message.content_type == "photo":
            item["file_id"] = message.photo[-1].file_id
        elif message.content_type in ("audio", "voice", "document", "video"):
            arquivo = getattr(message, message.content_type)
            item["file_id"] = arquivo.file_id

        collector.add(chat_id, item)