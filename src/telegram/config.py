import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
# API_URL = os.getenv("API_URL")
# API_KEY = os.getenv("API_KEY")

if not TELEGRAM_BOT_TOKEN:
    raise ValueError("TELEGRAM_BOT_TOKEN não configurado")

# if not API_URL:
#     raise ValueError("API_URL não configurada")

# if not API_KEY:
#     raise ValueError("API_KEY não configurada")