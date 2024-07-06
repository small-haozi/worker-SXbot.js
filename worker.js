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
const localFraudList = []; // 本地存储骗子ID的数组
let chatTargetUpdated = false; // 标志是否更新了聊天目标

const blockedUsers = []; // 本地存储被屏蔽用户的数组
let pendingMessage = null; // 全局变量保存待发送的消息


// 在程序启动时加载会话状态
loadChatSession();
// 在程序启动时加载被屏蔽用户列表
loadBlockedUsers();
// 在程序启动时加载骗子列表
loadFraudList();

function escapeMarkdown(text) {
  return text.replace(/([_*[\]()~`>#+-=|{}.!])/g, '\\$1');
}


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
        callback_data: option.callback_data
      }])
    }
  };
}

async function saveChatSession() {
  await FRAUD_LIST.put('chatSessions', JSON.stringify(chatSessions));
}

async function loadChatSession() {
  const storedSessions = await FRAUD_LIST.get('chatSessions');
  if (storedSessions) {
    Object.assign(chatSessions, JSON.parse(storedSessions));
  }
}

async function generateRecentChatButtons() {
  const recentChatTargets = await getRecentChatTargets();
  const buttons = await Promise.all(recentChatTargets.map(async chatId => {
    const userInfo = await getUserInfo(chatId);
    console.log(`UserInfo for chatId ${chatId}:`, userInfo); // 调试信息
    const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${chatId}`;
    return {
      text: `发给： ${nickname}`,
      callback_data: `select_${chatId}`
    };
  }));
  return generateKeyboard(buttons);
}

async function saveBlockedUsers() {
  await FRAUD_LIST.put('blockedUsers', JSON.stringify(blockedUsers));
}

async function searchUserByUID(uid) {
  const userInfo = await getUserInfo(uid);
  if (userInfo) {
    const nickname = `${userInfo.first_name} ${userInfo.last_name || ''}`.trim();
    return `UID: ${uid}, 昵称: ${nickname}`;
  } else {
    return `无法找到 UID: ${uid} 的用户信息`;
  }
}

async function loadBlockedUsers() {
  const storedList = await FRAUD_LIST.get('blockedUsers');
  if (storedList) {
    blockedUsers.push(...JSON.parse(storedList));
  }
}

// 最近聊天目标函数
async function saveRecentChatTargets(chatId) {
  let recentChatTargets = await FRAUD_LIST.get('recentChatTargets', { type: "json" }) || [];
  // 如果聊天目标已经存在，则移到最前面
  recentChatTargets = recentChatTargets.filter(id => id !== chatId.toString());
  recentChatTargets.unshift(chatId.toString());
  // 保持最多五个聊天目标
  if (recentChatTargets.length > 5) {
    recentChatTargets.pop();
  }
  await FRAUD_LIST.put('recentChatTargets', JSON.stringify(recentChatTargets));
}

async function getRecentChatTargets() {
  let recentChatTargets = await FRAUD_LIST.get('recentChatTargets', { type: "json" }) || [];
  return recentChatTargets.map(id => id.toString());
}


// 保存骗子id到kv空间
async function saveFraudList() {
  await FRAUD_LIST.put('localFraudList', JSON.stringify(localFraudList));
}

async function loadFraudList() {
  const storedList = await FRAUD_LIST.get('localFraudList');
  if (storedList) {
    localFraudList.push(...JSON.parse(storedList));
  }
}

async function setBotCommands() {
  const commands = [
    { command: 'start', description: '启动机器人会话' },
    { command: 'help', description: '显示帮助信息' },
    { command: 'search', description: '查看指定uid用户最新昵称' },
    { command: 'block', description: '屏蔽用户 (仅管理员)' },
    { command: 'unblock', description: '解除屏蔽用户 (仅管理员)' },
    { command: 'checkblock', description: '检查用户是否被屏蔽 (仅管理员)' },
    { command: 'fraud', description: '添加骗子ID - [本地库] (仅管理员)' },
    { command: 'unfraud', description: '移除骗子ID - [本地库] (仅管理员)' },
    { command: 'list', description: '查看骗子ID列表 - [本地库] (仅管理员)' },
    { command: 'blocklist', description: '查看屏蔽用户列表 - [本地库] (仅管理员)' }
    
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
  console.log(`Response for getUserInfo with chatId ${chatId}:`, response); // 调试信息
  if (response.ok) {
    return response.result;
  } else {
    console.error(`Failed to get user info for chat ID ${chatId}:`, response);
    return null;
  }
}

async function getChatMember(chatId) {
  const response = await requestTelegram('getChatMember', makeReqBody({ chat_id: chatId, user_id: chatId }));
  console.log(`Response for getChatMember with chatId ${chatId}:`, response); // 调试信息
  if (response.ok) {
    return response.result;
  } else {
    console.error(`Failed to get chat member info for chat ID ${chatId}:`, response);
    return null;
  }
}

async function getUserProfilePhotos(userId) {
  const response = await requestTelegram('getUserProfilePhotos', makeReqBody({ user_id: userId }));
  console.log(`Response for getUserProfilePhotos with userId ${userId}:`, response); // 调试信息
  if (response.ok) {
    const photos = response.result.photos;
    if (photos.length > 0) {
      return `用户存在，头像数量: ${photos.length}`;
    } else {
      return '用户存在，但没有头像';
    }
  } else {
    console.error(`Failed to get user profile photos for user ID ${userId}:`, response);
    return null;
  }
}

async function getChat(chatId) {
  const response = await requestTelegram('getChat', makeReqBody({ chat_id: chatId }));
  console.log(`Response for getChat with chatId ${chatId}:`, response); // 调试信息
  if (response.ok) {
    return response.result;
  } else {
    console.error(`Failed to get chat info for chat ID ${chatId}:`, response);
    return null;
  }
}

async function onMessage(message) {
  const chatId = message.chat.id.toString();

  // 初始化会话状态
  if (!chatSessions[chatId]) {
    chatSessions[chatId] = {
      step: 0,
      lastInteraction: Date.now()
    };
  }

  const session = chatSessions[chatId];

  // 更新最后交互时间
  session.lastInteraction = Date.now();

  // 获取当前聊天目标
  currentChatTarget = await getCurrentChatTarget();

  if (message.reply_to_message) {
    const repliedChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
    if (repliedChatId) {
      currentChatTarget = repliedChatId;
      await setCurrentChatTarget(repliedChatId); // 更新当前聊天目标
      await saveRecentChatTargets(repliedChatId); // 保存最近的聊天目标

      // 获取被回复用户的信息
      const userInfo = await getUserInfo(repliedChatId);
      let nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${repliedChatId}`;
      nickname = escapeMarkdown(nickname); // 转义 Markdown 特殊符号
      const chatLink = userInfo.username ? `https://t.me/${userInfo.username}` : `tg://user?id=${repliedChatId}`; // 生成聊天链接

      // 发送切换聊天目标的通知
      await sendMessage({
        chat_id: ADMIN_UID,
        parse_mode: 'MarkdownV2', // 使用Markdown格式
        text: `已切换到聊天目标:【 *${nickname}* 】 \nuid：${repliedChatId}\n[点击不用bot直接私聊](${chatLink})`
      });
    }
  }

  if (message.text) {
    if (message.text === '/start') {
      let startMsg = "欢迎使用聊天机器人";
      await setBotCommands();
      return sendMessage({
        chat_id: message.chat.id,
        text: startMsg,
      });
    } else if (message.text === '/help') {
      let helpMsg = "可用指令列表:\n" +
                    "/start - 启动机器人会话\n" +
                    "/help - 显示此帮助信息\n" +
                    "/search - 通过uid查询最新名字\n" + //查看指定uid最新用户名
                    "/block - 屏蔽用户 (仅管理员)\n" +
                    "/unblock - 解除屏蔽用户 (仅管理员)\n" +
                    "/checkblock - 检查用户是否被屏蔽 (仅管理员)\n" +
                    "/fraud - 添加骗子ID (仅管理员)\n" + // 更新帮助信息
                    "/unfraud - 移除骗子ID (仅管理员)\n" + // 更新帮助信息
                    "/list - 查看本地骗子ID列表 (仅管理员)\n" + // 添加新命令
                    "/blocklist - 查看被屏蔽用户列表 (仅管理员)\n" + // 添加新命令
                    "更多指令将在后续更新中添加。";
      return sendMessage({
        chat_id: message.chat.id,
        text: helpMsg,
      });
    } else if (message.text === '/blocklist') {
      return listBlockedUsers();
    } else if (message.text.startsWith('/unblock ')) {
      const index = parseInt(message.text.split(' ')[1], 10);
      if (!isNaN(index)) {
        return unblockByIndex(index);
      } else {
        return sendMessage({
          chat_id: ADMIN_UID,
          text: '无效的序号。'
        });
      }
    } else if (message.text === '/list' && message.chat.id.toString() === ADMIN_UID) {
      // 处理 /list 命令
      const storedList = await FRAUD_LIST.get('localFraudList');
      if (storedList) {
        localFraudList.length = 0; // 清空当前列表，确保只包含最新数据
        localFraudList.push(...JSON.parse(storedList));
      }

      if (localFraudList.length === 0) {
        return sendMessage({
          chat_id: message.chat.id,
          text: '本地没有骗子ID。'
        });
      } else {
        const fraudListText = await Promise.all(localFraudList.map(async uid => {
          const userInfo = await searchUserByUID(uid);
          const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : '未知';
          return `UID: ${uid}, 昵称: ${nickname}`;
        }));
        return sendMessage({
          chat_id: message.chat.id,
          text: `本地骗子ID列表:\n${fraudListText.join('\n')}`
        });
      }
    } else if (message.text.startsWith('/search') && message.chat.id.toString() === ADMIN_UID) {
      const parts = message.text.split(' ');
      if (parts.length === 2) {
        const searchId = parts[1].toString(); // 确保 UID 是字符串类型
        const userInfo = await searchUserByUID(searchId);
        if (userInfo) {
          const nickname = `${userInfo.user.first_name} ${userInfo.user.last_name || ''}`.trim();
          return sendMessage({
            chat_id: message.chat.id,
            text: `UID: ${searchId}, 昵称: ${nickname}`
          });
        } else {
          return sendMessage({
            chat_id: message.chat.id,
            text: `无法找到 UID: ${searchId} 的用户信息`
          });
        }
      } else {
        return sendMessage({
          chat_id: message.chat.id,
          text: '使用方法: /search <用户UID>'
        });
      }
    } else if (message.text.startsWith('/fraud') && message.chat.id.toString() === ADMIN_UID) {
      const parts = message.text.split(' ');
      if (parts.length === 2) {
        const fraudId = parts[1].toString(); // 确保 UID 是字符串类型
        if (!localFraudList.includes(fraudId)) { // 检查是否已经存在
          localFraudList.push(fraudId); // 添加到本地数组
          await saveFraudList(); // 保存更新后的列表
          return sendMessage({
            chat_id: message.chat.id,
            text: `已添加骗子ID: ${fraudId}`
          });
        } else {
          return sendMessage({
            chat_id: message.chat.id,
            text: `骗子ID: ${fraudId} 已存在`
          });
        }
      } else {
        return sendMessage({
          chat_id: message.chat.id,
          text: '使用方法: /fraud <用户UID>'
        });
      }
    } else if (message.text.startsWith('/unfraud') && message.chat.id.toString() === ADMIN_UID) {
      const parts = message.text.split(' ');
      if (parts.length === 2) {
        const fraudId = parts[1].toString(); // 确保 UID 是字符串类型
        const index = localFraudList.indexOf(fraudId);
        if (index > -1) {
          localFraudList.splice(index, 1); // 从本地数组中移除
          await saveFraudList(); // 保存更新后的列表
          return sendMessage({
            chat_id: message.chat.id,
            text: `已移除骗子ID: ${fraudId}`
          });
        } else {
          return sendMessage({
            chat_id: message.chat.id,
            text: `骗子ID: ${fraudId} 不在本地列表中`
          });
        }
      } else {
        return sendMessage({
          chat_id: message.chat.id,
          text: '使用方法: /unfraud <用户UID>'
        });
      }
    }
  }


  // 以下是管理员专用命令
  if (message.text === '/block') {
    if (message.reply_to_message) {
      return handleBlock(message);
    } else {
      return sendMessage({
        chat_id: message.chat.id,
        text: '使用方法: 请回复某条消息并输入 /block 来屏蔽用户。'
      });
    }
  }
  if (message.text === '/unblock') {
    if (message.reply_to_message) {
      return handleUnBlock(message);
    } else {
      return sendMessage({
        chat_id: message.chat.id,
        text: '使用方法: 请【 回复某条消息并输入 /unblock 】 或 【使用 /unblock 屏蔽序号 】来解除屏蔽用户。\n 屏蔽序号可以通过 /blocklist 获取'
      });
    }
  }
  if (message.text === '/checkblock') {
    if (message.reply_to_message) {
      return checkBlock(message);
    } else {
      return sendMessage({
        chat_id: message.chat.id,
        text: '使用方法: 请回复某条消息并输入 /checkblock 来检查用户是否被屏蔽。'
      });
    }
  }
  if (message.chat.id.toString() === ADMIN_UID) {
    if (message.reply_to_message) {
      let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
      console.log("guestChatId:", guestChatId); // 日志输出
      if (guestChatId) {
        currentChatTarget = guestChatId;  // 更新当前聊天目标
        await saveRecentChatTargets(guestChatId); // 保存最近的聊天目标
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
        // 保存消息内容
        pendingMessage = message;
        const recentChatButtons = await generateRecentChatButtons();
        return sendMessage({
          chat_id: ADMIN_UID,
          text: "没有设置当前聊天目标!\n请先通过【回复某条消息】或【点击下方按钮】来设置聊天目标。",
          reply_markup: recentChatButtons.reply_markup
        });
      }
      if (message.text) {
        // 直接发送文本消息到当前聊天目标
        await sendMessage({
          chat_id: currentChatTarget,
          text: message.text,
        });
      } else if (message.photo || message.video || message.document || message.audio) {
        console.log("Copying media message:", message.message_id); // 日志输出
        // 如果消息包含媒体文件，使用 copyMessage 方法复制媒体文件
        await copyMessage({
          chat_id: currentChatTarget,
          from_chat_id: message.chat.id,
          message_id: message.message_id,
        });
      }
    }
    return; // 确保管理员自己不会收到消息
  }
  return handleGuestMessage(message);
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

async function handleGuestMessage(message) {
  let chatId = message.chat.id.toString();
  let isblocked = await nfd.get('isblocked-' + chatId, { type: "json" });

  if (isblocked) {
    return sendMessage({
      chat_id: chatId,
      text: '您已被屏蔽'
    });
  }

  let forwardReq = await forwardMessage({
    chat_id: ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id
  });

  if (forwardReq.ok) {
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId);
    // 只有当新的聊天目标与当前聊天目标不同时，才发送提示按钮
    if (currentChatTarget !== chatId) {
      chatTargetUpdated = false; // 重置标志，因为有新的聊天目标
      if (!chatTargetUpdated) { // 检查标志
        const userInfo = await getUserInfo(chatId);
        let nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${chatId}`;
        nickname = escapeMarkdown(nickname); // 转义 Markdown 特殊符号
        const chatLink = `tg://user?id=${chatId}`; // 生成聊天链接
        let messageText = `新的聊天目标: \n*${nickname}*\nUID: ${chatId}\n[点击不用bot直接私聊](${chatLink})`;
        if (await isFraud(chatId)) {
          messageText += `\n\n*请注意，对方是骗子!*`; // 添加警告信息
        }
        await sendMessage({
          chat_id: ADMIN_UID,
          parse_mode: 'MarkdownV2', // 使用Markdown格式
          text: messageText,
          ...generateKeyboard([{ text: `选择${nickname}`, callback_data: `select_${chatId}` }])
        });
        chatTargetUpdated = true; // 设置标志
      }
    } else {
      chatTargetUpdated = true; // 如果当前聊天目标与消息发送者相同，更新标志
    }
    // 将新的聊天目标添加到最近聊天的数组中
    await saveRecentChatTargets(chatId);
  }
  return handleNotify(message);
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
      await saveRecentChatTargets(selectedChatId); // 保存最近的聊天目标
      await setCurrentChatTarget(selectedChatId); // 更新当前聊天目标
      const userInfo = await getUserInfo(selectedChatId);
      let nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${selectedChatId}`;
      nickname = escapeMarkdown(nickname); // 转义 Markdown 特殊符号
      const chatLink = userInfo.username ? `https://t.me/${userInfo.username}` : `tg://user?id=${selectedChatId}`; // 生成聊天链接
      let messageText = `已切换到聊天目标:【 *${nickname}* 】 \nuid：${selectedChatId}\n[点击不用bot直接私聊](${chatLink})`;
      if (await isFraud(selectedChatId)) {
        messageText += `\n\n*请注意，对方是骗子!*`; // 添加警告信息
      }
      // 发送切换聊天目标的通知
      await sendMessage({
        chat_id: ADMIN_UID,
        parse_mode: 'MarkdownV2', // 使用Markdown格式
        text: messageText
      });
      // 新增：更新会话状态
      chatSessions[ADMIN_UID] = {
        target: selectedChatId,
        timestamp: Date.now()
      };
      await saveChatSession();
      // 发送之前保存的消息
      // 发送之前保存的消息
      // 发送之前保存的消息
      if (pendingMessage) {
        try {
          if (pendingMessage.text) {
            await sendMessage({
              chat_id: currentChatTarget,
              text: pendingMessage.text,
            });
          } else if (pendingMessage.photo) {
            await copyMessage({
              chat_id: currentChatTarget,
              from_chat_id: ADMIN_UID,
              message_id: pendingMessage.message_id,
            });
          } else if (pendingMessage.video) {
            await copyMessage({
              chat_id: currentChatTarget,
              from_chat_id: ADMIN_UID,
              message_id: pendingMessage.message_id,
            });
          } else if (pendingMessage.document) {
            await copyMessage({
              chat_id: currentChatTarget,
              from_chat_id: ADMIN_UID,
              message_id: pendingMessage.message_id,
            });
          } else if (pendingMessage.audio) {
            await copyMessage({
              chat_id: currentChatTarget,
              from_chat_id: ADMIN_UID,
              message_id: pendingMessage.message_id,
            });
          }
          await sendMessage({
            chat_id: ADMIN_UID,
            text: "消息已成功转发给目标用户。",
            reply_to_message_id: pendingMessage.message_id // 引用上一条消息
          });
        } catch (error) {
          await sendMessage({
            chat_id: ADMIN_UID,
            text: "消息转发失败，请重试。",
            reply_to_message_id: pendingMessage.message_id // 引用上一条消息
          });
        }
        pendingMessage = null; // 清空待发送消息
      }
    }
  }
}

// 新增：获取当前聊天目标
async function getCurrentChatTarget() {
  const session = await FRAUD_LIST.get('currentChatTarget', { type: 'json' });
  if (session) {
    const elapsed = Date.now() - session.timestamp;
    if (elapsed < 30 * 60 * 1000) { // 30分钟
      return session.target;
    } else {
      await FRAUD_LIST.delete('currentChatTarget'); // 删除过期的聊天目标
    }
  }
  return null;
}

async function setCurrentChatTarget(target) {
  const session = {
    target: target,
    timestamp: Date.now()
  };
  await FRAUD_LIST.put('currentChatTarget', JSON.stringify(session));
}

async function handleNotify(message) {
  // 先判断是否是诈骗人员，如果是，则直接提醒
  // 如果不是，则根据时间间隔提醒：用户id，交易注意点等
  let chatId = message.chat.id;
  if (await isFraud(chatId)) {
    return sendMessage({
      chat_id: ADMIN_UID,
      parse_mode: 'Markdown', // 使用Markdown格式
      text: `*请注意对方是骗子*！！ \n UID：${chatId}`
    });
  }
  if (enable_notification) {
    let lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: "json" });
    if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {
      await nfd.put('lastmsg-' + chatId, Date.now());
      return sendMessage({
        chat_id: ADMIN_UID,
        text: await fetch(notificationUrl).then(r => r.text())
      });
    }
  }
}

async function handleBlock(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  if (guestChatId === ADMIN_UID) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '不能屏蔽自己'
    });
  }
  const userInfo = await getUserInfo(guestChatId);
  const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${guestChatId}`;
  await nfd.put('isblocked-' + guestChatId, true);

  blockedUsers.push(guestChatId); // 添加到本地数组
  await saveBlockedUsers(); // 保存更新后的列表

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname} 已被屏蔽`,
  });
}

async function handleUnBlock(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  const userInfo = await getUserInfo(guestChatId);
  const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${guestChatId}`;
  await nfd.put('isblocked-' + guestChatId, false);

  const index = blockedUsers.indexOf(guestChatId);
  if (index > -1) {
    blockedUsers.splice(index, 1); // 从本地数组中移除
    await saveBlockedUsers(); // 保存更新后的列表
  }

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname} 已解除屏蔽`,
  });
}

async function checkBlock(message) {
  let guestChatId = await nfd.get('msg-map-' + message.reply_to_message.message_id, { type: "json" });
  let isBlocked = await nfd.get('isblocked-' + guestChatId, { type: "json" });
  const userInfo = await getUserInfo(guestChatId);
  const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${guestChatId}`;
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname}` + (isBlocked ? ' 已被屏蔽' : ' 未被屏蔽')
  });
}


async function listBlockedUsers() {
  if (blockedUsers.length === 0) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '没有被屏蔽的用户。'
    });
  } else {
    const blockedListText = await Promise.all(blockedUsers.map(async (uid, index) => {
      const userInfo = await getUserInfo(uid);
      const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : '未知';
      return `${index + 1}. UID: ${uid}, 昵称: ${nickname}`;
    }));
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `被屏蔽的用户列表:\n${blockedListText.join('\n')}`
    });
  }
}

async function unblockByIndex(index) {
  if (index < 1 || index > blockedUsers.length) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '无效的序号。'
    });
  }
  const guestChatId = blockedUsers[index - 1];
  await nfd.put('isblocked-' + guestChatId, false); // 确保键名一致
  blockedUsers.splice(index - 1, 1); // 从本地数组中移除
  await saveBlockedUsers(); // 保存更新后的列表
  const userInfo = await getUserInfo(guestChatId);
  const nickname = userInfo ? `${userInfo.first_name} ${userInfo.last_name || ''}`.trim() : `UID:${guestChatId}`;
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `用户 ${nickname} 已解除屏蔽`,
  });
}



//Send plain text message
//https://core.telegram.org/bots/api#sendmessage

async function sendPlainText(chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  });
}

//
//  Set webhook to this worker's url
//  https://core.telegram.org/bots/api#setwebhook

async function registerWebhook (event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

//
// Remove webhook
// https://core.telegram.org/bots/api#setwebhook

async function unRegisterWebhook (event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

async function isFraud(id){
  id = id.toString();
  if (localFraudList.includes(id)) {
    return true;
  }
  let db = await fetch(fraudDb).then(r => r.text());
  let arr = db.split('\n').filter(v => v);
  return arr.includes(id);
}
