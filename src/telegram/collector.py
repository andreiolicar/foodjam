sessions = {}


def start(chat_id):
    if chat_id in sessions:
        return False

    sessions[chat_id] = []
    return True


def is_active(chat_id):
    return chat_id in sessions


def add(chat_id, message):
    if chat_id not in sessions:
        return False

    sessions[chat_id].append(message)
    return True


def finish(chat_id):
    return sessions.pop(chat_id, None)


def restore(chat_id, messages):
    sessions[chat_id] = messages