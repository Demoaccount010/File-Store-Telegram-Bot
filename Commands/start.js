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
  // ========================= FORCE-SUB CHECK FUNCTION =========================
  async function checkForceSub(bot, userId, chatId, payload = "") {
    let botData = await BotModel.findOne();
    if (!botData || botData.forcesub !== "enable") return true;

    for (let ch of botData.forceChannels) {
      if (!ch.startsWith("@")) ch = "@" + ch;

      try {
        const member = await bot.getChatMember(ch, userId);

        // ------------------- USER NOT JOINED MESSAGE -------------------
        if (member.status === "left" || member.status === "kicked") {
          await bot.sendMessage(
            chatId,
            `😎 **Hey Buddy ${member.user?.first_name || ""}!**\n\n` +
              `🚀 *File unlock karne se pehle ek chhota sa step hai...*\n\n` +
              `💛 **Please join our required channels** to continue!\n\n` +
              `✨ *Join karlo bro, family ka hissa ban jao!*`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  ...botData.forceChannels.map((c) => [
                    {
                      text: `📢 Join ${c}`,
                      url: `https://t.me/${c.replace("@", "")}`,
                    },
                  ]),
                  [
                    {
                      text: "🔄 I Joined, Unlock File",
                      callback_data: "tryagain_" + payload,
                    },
                  ],
                ],
              },
            }
          );

          return false;
        }
      } catch (err) {
        console.log("ForceSub error:", err);
      }
    }

    return true;
  }

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
    if (userId !== Number(OWNER_ID)) {
      const ok = await checkForceSub(bot, userId, chatId, payload);
      if (!ok) return; // stop file sending
    }

    // ===================== PAYLOAD HANDLING (FILE/BATCH) =====================
    if (payload) {
      const fileData =
        (await FileModel.findOne({ uniqueId: payload })) ||
        (await BatchModel.findOne({ batchId: payload }));

      if (!fileData) {
        return bot.sendMessage(chatId, "❌ Invalid or expired link.");
      }

      // ========== SINGLE FILE SEND ==========
      if (fileData.fileId) {
        let sent;

        if (fileData.type === "photo") {
          sent = await bot.sendPhoto(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName,
          });
        } else if (fileData.type === "video") {
          sent = await bot.sendVideo(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName,
          });
        } else if (fileData.type === "audio") {
          sent = await bot.sendAudio(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName,
          });
        } else {
          sent = await bot.sendDocument(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName,
          });
        }

        if (botData.autodel === "enable") {
          bot.sendMessage(
            chatId,
            "⏳ *This file will be auto-deleted in 10 minutes.*\nSave it now! 🔐",
            { parse_mode: "Markdown" }
          );

          setTimeout(() => {
            bot.deleteMessage(chatId, sent.message_id).catch(() => {});
          }, 600000);
        }

        return;
      }

      // ========== BATCH SEND ==========
      if (fileData.files && fileData.files.length > 0) {
        let ids = [];
        for (const f of fileData.files) {
          const sent = await bot.sendDocument(chatId, f.fileId, {
            caption: f.caption || f.fileName,
          });
          ids.push(sent.message_id);
          await new Promise((r) => setTimeout(r, 800));
        }

        bot.sendMessage(chatId, "📦 All batch files sent successfully!");

        if (botData.autodel === "enable") {
          bot.sendMessage(
            chatId,
            "⏳ These batch files will be auto-deleted in 10 minutes.",
            { parse_mode: "Markdown" }
          );

          setTimeout(() => {
            ids.forEach((id) =>
              bot.deleteMessage(chatId, id).catch(() => {})
            );
          }, 600000);
        }

        return;
      }
    }

    // ===================== DEFAULT START MENU =====================
    await bot.sendPhoto(chatId, START_IMAGE_URL, {
      caption: `Hey ${firstName} 😄!\n\nWelcome to your personal File Store Bot.\nJust send any file and get a sharable link instantly! 🚀`,
      reply_markup: {
        inline_keyboard: [
          [
            { text: "❓ Help", callback_data: "help" },
            { text: "ℹ️ About", callback_data: "about" },
          ],
          [
            { text: "👨‍💻 Developer", callback_data: "OwnerInfo" },
            { text: "📜 Legal", callback_data: "legal" },
          ],
          [
            { text: "📢 Update Channel", url: "https://t.me/crunchyroll_hindi_dub_yt" },
          ],
        ],
      },
      parse_mode: "HTML",
    });
  });

  // =========================== CALLBACK HANDLER ===========================
  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const mid = query.message.message_id;
    const fname = query.from.first_name;

    // ---------------- TRY AGAIN (AFTER JOINING) ----------------
    if (query.data.startsWith("tryagain_")) {
      const payload = query.data.replace("tryagain_", "");
      const userId = query.from.id;

      const ok = await checkForceSub(bot, userId, chatId, payload);
      if (!ok) return bot.answerCallbackQuery(query.id, { text: "❗Bro join first!", show_alert: true });

      bot.deleteMessage(chatId, mid).catch(() => {});
      
      // AUTOMATICALLY SEND FILE AGAIN
      const fileData =
        (await FileModel.findOne({ uniqueId: payload })) ||
        (await BatchModel.findOne({ batchId: payload }));

      if (!fileData) {
        return bot.sendMessage(chatId, "❌ File expired or removed.");
      }

      // send again...
      if (fileData.fileId) {
        return bot.sendDocument(chatId, fileData.fileId, {
          caption: fileData.caption || fileData.fileName,
        });
      }

      if (fileData.files) {
        for (const f of fileData.files) {
          await bot.sendDocument(chatId, f.fileId, {
            caption: f.caption || f.fileName,
          });
          await new Promise((r) => setTimeout(r, 600));
        }
        return;
      }
    }

    // ---------------- NORMAL MENU BUTTONS ----------------
    const btn = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "❓ Help", callback_data: "help" },
            { text: "ℹ️ About", callback_data: "about" },
          ],
          [
            { text: "👨‍💻 Developer", callback_data: "OwnerInfo" },
            { text: "📜 Legal", callback_data: "legal" },
          ],
          [
            { text: "📢 Update Channel", url: "https://t.me/crunchyroll_hindi_dub_yt" },
          ],
        ],
      },
      parse_mode: "HTML",
    };

    const OwnerInfo = `
<b>🌟 Owner Details 🌟</b>
<b>Name:</b> Your Smile  
<b>Telegram:</b> @crunchyroll_hindi_dub_yt
`;

    const help = `
<b>🆘 Help Menu</b>
Use this bot to store and share files.

Commands:
/start  
/batch  
/finishbatch  
/users  
/broadcast  
`;

    const about = `
<b>ℹ️ About Bot</b>
Name: @${botUsername}
Creator: @crunchyroll_hindi_dub_yt
Language: NodeJS
Database: MongoDB
`;

    const legal = `
<b>📜 Legal Notice</b>
Do not upload illegal or copyrighted content.
You are responsible for your files.
`;

    if (query.data === "OwnerInfo")
      return bot.editMessageMedia(
        { type: "photo", media: START_IMAGE_URL, caption: OwnerInfo },
        { chat_id: chatId, message_id: mid, ...btn }
      );

    if (query.data === "help")
      return bot.editMessageMedia(
        { type: "photo", media: START_IMAGE_URL, caption: help },
        { chat_id: chatId, message_id: mid, ...btn }
      );

    if (query.data === "about")
      return bot.editMessageMedia(
        { type: "photo", media: START_IMAGE_URL, caption: about },
        { chat_id: chatId, message_id: mid, ...btn }
      );

    if (query.data === "legal")
      return bot.editMessageMedia(
        { type: "photo", media: START_IMAGE_URL, caption: legal },
        { chat_id: chatId, message_id: mid, ...btn }
      );
  });
};
