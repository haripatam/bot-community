const memoryStore = new Map();

function getSession(senderId) {
    let session = memoryStore.get(senderId);
    const now = Date.now();

    // 10 minutes session rule
    if (session && now - session.startTime > 10 * 60 * 1000) {
        memoryStore.delete(senderId);
        session = null;
    }

    if (!session) {
        session = {
            startTime: now,
            messageCount: 0,
            activeEvents: []  // Holds exact currently loaded list
        };
        memoryStore.set(senderId, session);
    }
    return session;
}

function updateSession(senderId, activeEvents) {
    const session = getSession(senderId);
    session.activeEvents = activeEvents;
    memoryStore.set(senderId, session);
}

function incrementMessageCheck(senderId) {
    const session = getSession(senderId);
    session.messageCount += 1;
    
    // 10 messages rule
    if (session.messageCount > 10) {
        memoryStore.delete(senderId);
        return true; 
    }
    return false;
}

module.exports = { getSession, updateSession, incrementMessageCheck };
