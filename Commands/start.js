module.exports = function (
  app,
  bot,
  UserModel,
  OWNER_ID,
  BotModel,
  botUsername,
  START_IMAGE_URL,
  FileModel,
  BatchModel
) {
  // ========================== /start COMMAND ==============================
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name;

    let botData = await BotModel.findOne();
    if (!botData) {
      botData = await BotModel.create({
        autodel: "disable",
        forcesub: "disable",
        forceChannels: [],
      });
    }

    const payload = match[1].trim().replace("?start=", "").replace("start=", "");

    // ===================== FORCE SUB FIRST CHECK =====================
    if (Number(userId) !== Number(OWNER_ID)) {
      if (botData.forcesub === "enable" && botData.forceChannels.length > 0) {
        for (let ch of botData.forceChannels) {
          if (!ch.startsWith("@")) ch = "@" + ch;

          try {
            const member = await bot.getChatMember(ch, userId);

            if (member.status === "left" || member.status === "kicked") {
              return bot.sendMessage(chatId, "⚠️ Please join required channels:", {
                reply_markup: {
                  inline_keyboard: [
                    ...botData.forceChannels.map((c) => [
                      {
                        text: `${c}`,
                        url: `https://t.me/${c.replace("@", "")}`,
                      },
                    ]),
                    [{ text: "I Joined ✔️", callback_data: "check_force" }],
                  ],
                },
              });
            }
          } catch (err) {}
        }
      }
    }

    // ===================== PAYLOAD HANDLING (FILE/BATCH) =====================
    if (payload) {
      const fileData =
        (await FileModel.findOne({ uniqueId: payload })) ||
        (await BatchModel.findOne({ batchId: payload }));

      if (!fileData) {
        return bot.sendMessage(chatId, "❌ Invalid or expired link.");
      }

      // ========== SINGLE FILE ==========
      if (fileData.fileId) {
        let sentMessage;

        if (fileData.type === "photo") {
          sentMessage = await bot.sendPhoto(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName,
          });
        } else if (fileData.type === "video") {
          sentMessage = await bot.sendVideo(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName,
          });
        } else if (fileData.type === "audio") {
          sentMessage = await bot.sendAudio(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName,
          });
        } else {
          sentMessage = await bot.sendDocument(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName,
          });
        }

        if (botData.autodel === "enable") {
          bot.sendMessage(
            chatId,
            "⚠️ Note: This file will be deleted after 10 minutes. Save it now!"
          );

          setTimeout(() => {
            bot.deleteMessage(chatId, sentMessage.message_id).catch(() => {});
          }, 600000);
        }

        return;
      }

      // ========== BATCH FILES ==========
      if (fileData.files && fileData.files.length > 0) {
        let msgIds = [];

        for (const f of fileData.files) {
          const sent = await bot.sendDocument(chatId, f.fileId, {
            caption: f.caption || f.fileName,
          });
          msgIds.push(sent.message_id);
          await new Promise((r) => setTimeout(r, 1000));
        }

        bot.sendMessage(chatId, "📦 All batch files sent successfully.");

        if (botData.autodel === "enable") {
          bot.sendMessage(chatId, "⚠️ These files will be auto-deleted in 10 minutes.");

          setTimeout(() => {
            msgIds.forEach((id) =>
              bot.deleteMessage(chatId, id).catch(() => {})
            );
          }, 600000);
        }

        return;
      }
    }

    // ===================== DEFAULT START MENU =====================
    await bot.sendPhoto(chatId, START_IMAGE_URL, {
      caption: `Hello, ${firstName}! 👋\n\nWelcome to the bot.\n\nSend me any file to get a share link.`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Help", callback_data: "help" },
            { text: "About", callback_data: "about" },
          ],
          [
            { text: "Developer Info", callback_data: "OwnerInfo" },
            { text: "Legal Disclaimer", callback_data: "legal" },
          ],
          [{ text: "Update Channel", url: "https://t.me/crunchyroll_hindi_dub_yt" }],
        ],
      },
      parse_mode: "HTML",
    });
  });

  // ========================== CALLBACK BUTTONS ==========================
  const OwnerInfo = `
<b>🌟 Owner Details 🌟</b>

<b>🧑‍💻 Name:</b> Your Smile
<b>📱 Telegram:</b> @crunchyroll_hindi_dub_yt
  `;

  const help = `
<b>> Help Menu</b>

I am a permanent file store bot. You can store files publicly.

<b>> Commands:</b>
/start - Check bot
/batch - Create batch
/finishbatch - Finish batch
/users - View user count
/broadcast - Broadcast message
  `;

  const aboutMessage = `
<b>🎥 My Name:</b> @${botUsername}
<b>Creator:</b> @crunchyroll_hindi_dub_yt
<b>Language:</b> NodeJS
<b>Database:</b> MongoDB
  `;

  const legalText = `
<b>📜 Legal Disclaimer</b>
This bot is for educational use only.
Do not upload copyrighted or illegal content.
You are responsible for your uploads.
  `;

  bot.on("callback_query", (query) => {
    const chatId = query.message.chat.id;
    const mid = query.message.message_id;
    const fname = query.from.first_name;

    const backButtons = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Help", callback_data: "help" },
            { text: "About", callback_data: "about" },
          ],
          [
            { text: "Developer Info", callback_data: "OwnerInfo" },
            { text: "Legal Disclaimer", callback_data: "legal" },
          ],
          [{ text: "Update Channel", url: "https://t.me/crunchyroll_hindi_dub_yt" }],
        ],
      },
    };

    if (query.data === "OwnerInfo") {
      return bot.editMessageMedia(
        { type: "photo", media: START_IMAGE_URL, caption: OwnerInfo, parse_mode: "HTML" },
        { chat_id: chatId, message_id: mid, ...backButtons }
      );
    }

    if (query.data === "help") {
      return bot.editMessageMedia(
        { type: "photo", media: START_IMAGE_URL, caption: help, parse_mode: "HTML" },
        { chat_id: chatId, message_id: mid, ...backButtons }
      );
    }

    if (query.data === "about") {
      return bot.editMessageMedia(
        { type: "photo", media: START_IMAGE_URL, caption: aboutMessage, parse_mode: "HTML" },
        { chat_id: chatId, message_id: mid, ...backButtons }
      );
    }

    if (query.data === "legal") {
      return bot.editMessageMedia(
        { type: "photo", media: START_IMAGE_URL, caption: legalText, parse_mode: "HTML" },
        { chat_id: chatId, message_id: mid, ...backButtons }
      );
    }

    if (query.data === "back") {
      return bot.editMessageMedia(
        {
          type: "photo",
          media: START_IMAGE_URL,
          caption: `Hello, ${fname}! 👋\n\nSend me any file to get share link.`,
        },
        { chat_id: chatId, message_id: mid, ...backButtons }
      );
    }
  });
};
