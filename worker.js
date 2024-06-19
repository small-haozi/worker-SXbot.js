const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = ENV_ADMIN_UID // your user id, get it from https://t.me/username_to_id_bot

const NOTIFY_INTERVAL = 3600 * 1000;
const fraudDb = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/fraud.db';
const notificationUrl = ''

const chatSessions = {};  // 存储所有聊天会话的状态

const enable_notification = true

let currentChatTarget = null;  // 当前聊天目标ID
let chatTargetUpdated = false; // 标志是否更新了聊天目标

/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl(methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null){
  return fetch(apiUrl(methodName, params), body)
    .then(r => r.json())
}

function makeReqBody(body){
  return {
    method:'POST',
    headers:{
      'content-type':'application/json'
    },
    body:JSON.stringify(body)
  }
}

function sendMessage(msg = {}){
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}){
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function forwardMessage(msg){
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

function generateKeyboard(options) {
  return {
    reply_markup: {
      inline_keyboard: options.map(option => [{
        text: option.text,
        callback_data: option.data
      }])
    }
  };
}

async function setBotCommands() {
  const commands = [
    { command: 'start', description: '启动机器人会话' },
    { command: 'help', description: '显示帮助信息' },
    { command: 'block', description: '屏蔽用户' },
    { command: 'unblock', description: '解除屏蔽用户' },
    { command: 'checkblock', description: '检查用户是否被屏蔽' }
    // 在此添加更多命令
  ];

  return requestTelegram('setMyCommands', makeReqBody({ commands }));
}

addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else if (url.pathname === '/setCommands') {
    event.respondWith(setBotCommands())
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})


async function handleWebhook(event) {
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }

  const update = await event.request.json()
  event.waitUntil(onUpdate(update))

  return new Response('Ok')
}

async function onUpdate(update) {
  if (update.message) {
    await onMessage(update.message);
  } else if (update.callback_query) {
    await onCallbackQuery(update.callback_query);
  }
}
async function getUserInfo(chatId) {
  const response = await requestTelegram('getChat', makeReqBody({ chat_id: chatId }));
  if (response.ok) {
    return response.result;
  } else {
    console.error(`Failed to get user info for chat ID ${chatId}:`, response);
    return null;
  }
}

async function onMessage(message) {
  if(message.text === '/start'){
    let startMsg = "\n欢迎使用GunZi的聊天机器人🎉🎉🎉\n\n你现在发送的消息GunZi能够收到❗❗\n\n他会尽快回复你❗❗\n\n"
    await setBotCommands()
    return sendMessage({
      chat_id:message.chat.id,
      text:startMsg,
    })
  } else if (message.text === '/help'){
    let helpMsg = "可用指令列表:\n" +
                  "/start - 启动机器人会话\n" +
                  "/help - 显示此帮助信息\n" +
                  "/block - 屏蔽用户 (仅管理员)\n" +
                  "/unblock - 解除屏蔽用户 (仅管理员)\n" +
                  "/checkblock - 检查用户是否被屏蔽 (仅管理员)\n" +
                  "更多指令将在后续更新中添加。";
    return sendMessage({
      chat_id: message.chat.id,
      text: helpMsg,
    });
  } 
  // 以下是管理员专用命令
  if(message.text === '/block' && message.reply_to_message){
    return handleBlock(message);
  }
  if(message.text === '/unblock' && message.reply_to_message){
    return handleUnBlock(message);
  }
  if(message.text === '/checkblock' && message.reply_to_message){
    return checkBlock(message);
  }
  if(message.chat.id.toString() === ADMIN_UID){
    if(message.reply_to_message){
      let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" })
      console.log("guestChatId:", guestChatId); // 日志输出
      if(guestChatId){
        currentChatTarget = guestChatId;  // 更新当前聊天目标
        if (message.text) {
          // 发送管理员输入的文本消息内容
          await sendMessage({
            chat_id: guestChatId,
            text: message.text,
          });
        } else if (message.photo || message.video || message.document || message.audio) {
          console.log("Copying media message:", message.message_id); // 日志输出
          // 如果消息包含媒体文件，使用 copyMessage 方法复制媒体文件
          await copyMessage({
            chat_id: guestChatId,
            from_chat_id: message.chat.id,
            message_id: message.message_id,
          });
        }
      }
    } else {
      if (!currentChatTarget) {
        return sendMessage({
          chat_id: ADMIN_UID,
          text: "没有设置当前聊天目标，请先通过回复某条消息来设置聊天目标。"
        });
      }
      if (message.text) {
        // 直接发送文本消息到当前聊天目标
        await sendMessage({
          chat_id: currentChatTarget,
          text: message.text,
        });
      } else if (message.photo) {
        await sendPhoto({
          chat_id: currentChatTarget,
          photo: message.photo[0].file_id,
          caption: message.caption || ''
        });
      } else if (message.video) {
        await sendVideo({
          chat_id: currentChatTarget,
          video: message.video.file_id,
          caption: message.caption || ''
        });
      } else if (message.document) {
        await sendDocument({
          chat_id: currentChatTarget,
          document: message.document.file_id,
          caption: message.caption || ''
        });
      } else if (message.audio) {
        await sendAudio({
          chat_id: currentChatTarget,
          audio: message.audio.file_id,
          caption: message.caption || ''
        });
      }
    }
    return; // 确保管理员自己不会收到消息
  }
  return handleGuestMessage(message)
}


async function sendDirectMessage(text) {
  if (currentChatTarget) {
    return sendMessage({
      chat_id: currentChatTarget,
      text: text
    });
  } else {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: "没有设置当前聊天目标，请先通过回复某条消息来设置聊天目标。"
    });
  }
}

async function handleGuestMessage(message){
  let chatId = message.chat.id.toString();
  let isblocked = await nfd.get('isblocked-' + chatId, { type: "json" })
  
  if(isblocked){
    return sendMessage({
      chat_id: chatId,
      text:'您已被屏蔽'
    })
  }

  let forwardReq = await forwardMessage({
    chat_id:ADMIN_UID,
    from_chat_id:message.chat.id,
    message_id:message.message_id
  });

  if(forwardReq.ok){
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId)
    // 只有当新的聊天目标与当前聊天目标不同时，才发送提示按钮
    if (currentChatTarget !== chatId) {
      chatTargetUpdated = false; // 重置标志，因为有新的聊天目标
      if (!chatTargetUpdated) { // 检查标志
        const userInfo = await getUserInfo(chatId);
        const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${chatId}`;
        await sendMessage({
          chat_id: ADMIN_UID,
          text: `新的聊天目标: ${nickname}`,
          ...generateKeyboard([{ text: `选择${nickname}`, data: `select_${chatId}` }])
        });
        chatTargetUpdated = true; // 设置标志
      }
    } else {
      chatTargetUpdated = true; // 如果当前聊天目标与消息发送者相同，更新标志
    }
  }
  return handleNotify(message)
}

async function sendPhoto(msg) {
  return requestTelegram('sendPhoto', makeReqBody(msg));
}

async function sendVideo(msg) {
  return requestTelegram('sendVideo', makeReqBody(msg));
}

async function sendDocument(msg) {
  return requestTelegram('sendDocument', makeReqBody(msg));
}

async function sendAudio(msg) {
  return requestTelegram('sendAudio', makeReqBody(msg));
}

async function onCallbackQuery(callbackQuery) {
  const data = callbackQuery.data;
  const message = callbackQuery.message;

  if (data.startsWith('select_')) {
    const selectedChatId = data.split('_')[1];
    if (currentChatTarget !== selectedChatId) {
      currentChatTarget = selectedChatId;
      chatTargetUpdated = true; // 设置标志
      const userInfo = await getUserInfo(selectedChatId);
      const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${selectedChatId}`;
      await sendMessage({
        chat_id: ADMIN_UID,
        text: `已切换到聊天目标: ${nickname}`
      });
    }
  }
}

async function handleNotify(message){
  // 先判断是否是诈骗人员，如果是，则直接提醒
  // 如果不是，则根据时间间隔提醒：用户id，交易注意点等
  let chatId = message.chat.id;
  if(await isFraud(chatId)){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:`检测到骗子，UID${chatId}`
    })
  }
  if(enable_notification){
    let lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: "json" })
    if(!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL){
      await nfd.put('lastmsg-' + chatId, Date.now())
      return sendMessage({
        chat_id: ADMIN_UID,
        text:await fetch(notificationUrl).then(r => r.text())
      })
    }
  }
}

async function handleBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
                                      { type: "json" })
  if(guestChantId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能屏蔽自己'
    })
  }
  const userInfo = await getUserInfo(guestChatId);
  const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${guestChatId}`;
  await nfd.put('isblocked-' + guestChantId, true)

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname} 已被屏蔽`,
  })
}

async function handleUnBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })
  const userInfo = await getUserInfo(guestChatId);
  const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${guestChatId}`;
  await nfd.put('isblocked-' + guestChantId, false)

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname} 已解除屏蔽`,
  })
}

async function checkBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })
  let blocked = await nfd.get('isblocked-' + guestChantId, { type: "json" })
  const userInfo = await getUserInfo(guestChatId);
  const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${guestChatId}`;
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname}` + (blocked ? ' 已被屏蔽' : ' 未被屏蔽')
  })
}

/**
 * Send plain text message
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendPlainText (chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  })
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook (event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook (event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

async function isFraud(id){
  id = id.toString()
  let db = await fetch(fraudDb).then(r => r.text())
  let arr = db.split('\n').filter(v => v)
  console.log(JSON.stringify(arr))
  let flag = arr.filter(v => v === id).length !== 0
  console.log(flag)
  return flag
}
