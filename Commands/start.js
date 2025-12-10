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
  // GIFs
  const START_GIF = "https://i.gifer.com/4tN0.gif";    // start animation (if you want to use)
  const FORCE_SUB_GIF = "https://i.gifer.com/LRP3.gif"; // shown when asking to join channels
  const VERIFY_GIF = "https://i.gifer.com/91Rt.gif";    // shown on successful verification

  // ========================= FORCE-SUB CHECK FUNCTION =========================
  async function checkForceSub(bot, userId, chatId, payload = "") {
    let botData = await BotModel.findOne();
    if (!botData || botData.forcesub !== "enable") return true;

    for (let ch of botData.forceChannels) {
      if (!ch.startsWith("@")) ch = "@" + ch;

      try {
        const member = await bot.getChatMember(ch, userId);

        // If user NOT joined, show friendly join message with GIF and "I Joined" button
        if (member.status === "left" || member.status === "kicked") {
          await bot.sendAnimation(chatId, FORCE_SUB_GIF, {
            caption:
              `😎 <b>Hey Buddy ${member.user?.first_name || ""}!</b>\n\n` +
              `🚀 <i>File unlock karne se pehle ek chhota sa step hai...</i>\n\n` +
              `💛 <b>Please join our required channels</b> to continue!\n\n` +
              `✨ <i>Join karlo bro, family ka hissa ban jao!</i>`,
            parse_mode: "HTML",
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
          });

          return false;
        }
      } catch (err) {
        console.log("ForceSub error:", err && err.response ? err.response.body : err);
        // If getChatMember fails (bot not admin / invalid channel), we don't block permanently.
        // Continue to next channel.
      }
    }

    return true;
  }

  // ========================== /start COMMAND ==============================
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || "there";

    let botData = await BotModel.findOne();
    if (!botData) {
      botData = await BotModel.create({
        autodel: "disable",
        forcesub: "disable",
        forceChannels: [],
      });
    }

    const payload = (match && match[1]) ? match[1].trim().replace("?start=", "").replace("start=", "") : "";

    // ===================== FORCE SUB FIRST CHECK =====================
    if (userId !== Number(OWNER_ID)) {
      const ok = await checkForceSub(bot, userId, chatId, payload);
      if (!ok) return; // stop file sending until user joins
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

        try {
          if (fileData.type === "photo") {
            sent = await bot.sendPhoto(chatId, fileData.fileId, {
              caption: fileData.caption || fileData.fileName || "",
              parse_mode: "HTML",
            });
          } else if (fileData.type === "video") {
            sent = await bot.sendVideo(chatId, fileData.fileId, {
              caption: fileData.caption || fileData.fileName || "",
              parse_mode: "HTML",
            });
          } else if (fileData.type === "audio") {
            sent = await bot.sendAudio(chatId, fileData.fileId, {
              caption: fileData.caption || fileData.fileName || "",
              parse_mode: "HTML",
            });
          } else {
            sent = await bot.sendDocument(chatId, fileData.fileId, {
              caption: fileData.caption || fileData.fileName || "",
            });
          }

          if (botData.autodel === "enable") {
            await bot.sendMessage(
              chatId,
              "⏳ <b>This file will be auto-deleted in 10 minutes.</b>\nSave it now! 🔐",
              { parse_mode: "HTML" }
            );

            setTimeout(() => {
              bot.deleteMessage(chatId, sent.message_id).catch(() => {});
            }, 600000);
          }
        } catch (e) {
          console.log("Send single file error:", e && e.response ? e.response.body : e);
          return bot.sendMessage(chatId, "⚠️ Failed to send the file. Try again later.");
        }

        return;
      }

      // ========== BATCH SEND ==========
      if (fileData.files && fileData.files.length > 0) {
        try {
          let ids = [];
          for (const f of fileData.files) {
            const sent = await bot.sendDocument(chatId, f.fileId, {
              caption: f.caption || f.fileName || "",
            });
            ids.push(sent.message_id);
            await new Promise((r) => setTimeout(r, 800));
          }

          await bot.sendMessage(chatId, "📦 All batch files sent successfully!");

          if (botData.autodel === "enable") {
            await bot.sendMessage(
              chatId,
              "⏳ <b>These batch files will be auto-deleted in 10 minutes.</b>",
              { parse_mode: "HTML" }
            );

            setTimeout(() => {
              ids.forEach((id) => bot.deleteMessage(chatId, id).catch(() => {}));
            }, 600000);
          }
        } catch (e) {
          console.log("Batch send error:", e && e.response ? e.response.body : e);
          return bot.sendMessage(chatId, "⚠️ Failed to send batch files. Try again later.");
        }

        return;
      }
    }

    // ===================== DEFAULT START MENU =====================
    // Use animation if START_IMAGE_URL not provided; otherwise send START_IMAGE_URL as photo + animation below optional
    try {
      if (START_IMAGE_URL) {
        await bot.sendPhoto(chatId, START_IMAGE_URL, {
          caption: `Hey <b>${firstName}</b> 😄!\n\nWelcome to your personal File Store Bot.\nJust send any file and get a sharable link instantly! 🚀`,
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
              [{ text: "📢 Update Channel", url: "https://t.me/crunchyroll_hindi_dub_yt" }],
            ],
          },
          parse_mode: "HTML",
        });
      } else {
        await bot.sendAnimation(chatId, START_GIF, {
          caption: `Hey <b>${firstName}</b> 😄!\n\nWelcome to your personal File Store Bot.\nJust send any file and get a sharable link instantly! 🚀`,
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
              [{ text: "📢 Update Channel", url: "https://t.me/crunchyroll_hindi_dub_yt" }],
            ],
          },
          parse_mode: "HTML",
        });
      }
    } catch (e) {
      // fallback text
      bot.sendMessage(
        chatId,
        `Hey ${firstName} 😄!\nWelcome to your personal File Store Bot.\nSend any file and get a shareable link.`,
        { parse_mode: "HTML" }
      );
    }
  });

  // =========================== CALLBACK HANDLER ===========================
  bot.on("callback_query", async (query) => {
    try {
      const chatId = query.message.chat.id;
      const mid = query.message.message_id;
      const userId = query.from.id;

      // ------------- TRY AGAIN (AFTER JOINING) -------------
      if (query.data && query.data.startsWith("tryagain_")) {
        const payload = query.data.replace("tryagain_", "");

        // re-check all channels
        let botData = await BotModel.findOne();
        if (!botData) {
          return bot.answerCallbackQuery(query.id, { text: "Configuration missing.", show_alert: true });
        }

        for (let ch of botData.forceChannels) {
          if (!ch.startsWith("@")) ch = "@" + ch;
          try {
            const member = await bot.getChatMember(ch, userId);
            if (member.status === "left" || member.status === "kicked") {
              return bot.answerCallbackQuery(query.id, { text: "❗ Bro, pehle join kar lo!", show_alert: true });
            }
          } catch (e) {
            // if any error, ask owner to check channel/admin
            return bot.answerCallbackQuery(query.id, { text: "Error checking channel. Contact owner.", show_alert: true });
          }
        }

        // All good — delete the old join message
        bot.deleteMessage(chatId, mid).catch(() => {});

        // Show verify animation
        await bot.sendAnimation(chatId, VERIFY_GIF, {
          caption: "🎉 <b>Verified!</b> Unlocking your file... 🔓",
          parse_mode: "HTML",
        });

        // Now send the file/batch
        const fileData =
          (await FileModel.findOne({ uniqueId: payload })) ||
          (await BatchModel.findOne({ batchId: payload }));

        if (!fileData) {
          return bot.sendMessage(chatId, "❌ File expired or removed.");
        }

        // send single
        if (fileData.fileId) {
          try {
            if (fileData.type === "photo") {
              await bot.sendPhoto(chatId, fileData.fileId, {
                caption: fileData.caption || fileData.fileName || "",
                parse_mode: "HTML",
              });
            } else if (fileData.type === "video") {
              await bot.sendVideo(chatId, fileData.fileId, {
                caption: fileData.caption || fileData.fileName || "",
                parse_mode: "HTML",
              });
            } else if (fileData.type === "audio") {
              await bot.sendAudio(chatId, fileData.fileId, {
                caption: fileData.caption || fileData.fileName || "",
                parse_mode: "HTML",
              });
            } else {
              await bot.sendDocument(chatId, fileData.fileId, {
                caption: fileData.caption || fileData.fileName || "",
              });
            }
          } catch (e) {
            console.log("Send after verify error:", e && e.response ? e.response.body : e);
            return bot.sendMessage(chatId, "⚠️ Failed to deliver file after verify. Try again later.");
          }

          return bot.answerCallbackQuery(query.id, { text: "✔ File delivered! Enjoy 🙂" });
        }

        // send batch
        if (fileData.files && fileData.files.length > 0) {
          try {
            for (const f of fileData.files) {
              await bot.sendDocument(chatId, f.fileId, {
                caption: f.caption || f.fileName || "",
              });
              await new Promise((r) => setTimeout(r, 700));
            }
          } catch (e) {
            console.log("Batch send after verify error:", e && e.response ? e.response.body : e);
            return bot.sendMessage(chatId, "⚠️ Failed to deliver batch after verify. Try again later.");
          }

          return bot.answerCallbackQuery(query.id, { text: "✔ Batch delivered! Enjoy 🙂" });
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
    } catch (err) {
      console.log("Callback handler error:", err && err.response ? err.response.body : err);
      // safe fallback
      try {
        bot.answerCallbackQuery((err && err.id) || 0, { text: "Error occurred. Try again later.", show_alert: false });
      } catch (e) {}
    }
  });
};
