# import requests

# from config import API_URL, API_KEY


# def send_messages(chat_id, message):
#     payload = {
#         "chat_id": chat_id,
#         "messages": message,
#     }

#     response = requests.post(
#         API_URL,
#         json=payload,
#         headers={
#             "Authorization": f"Bearer {API_KEY}"
#         },
#         timeout=20,
#     )

#     response.raise_for_status()
#     return response.json() if response.content else None