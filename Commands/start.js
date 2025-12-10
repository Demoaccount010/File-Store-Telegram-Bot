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
  // ---------------- GIF URLs (you already gave these) ----------------
  const START_GIF = "https://i.gifer.com/4tN0.gif";      // start screen gif
  const FORCE_SUB_GIF = "https://i.gifer.com/LRP3.gif";  // ask-to-join gif
  const VERIFY_GIF = "https://i.gifer.com/91Rt.gif";     // success verify gif

  // ---------------- helper to auto-delete messages ----------------
  function autoDelete(chatId, messageId, ms = 8000) {
    setTimeout(() => {
      try {
        bot.deleteMessage(chatId, messageId).catch(() => {});
      } catch (e) {}
    }, ms);
  }

  // ---------------- Force-sub check (returns true if ok) ----------------
  async function checkForceSub(userId, chatId, payload = "") {
    const botData = await BotModel.findOne();
    if (!botData || botData.forcesub !== "enable") return true;
    if (!Array.isArray(botData.forceChannels) || botData.forceChannels.length === 0) return true;

    for (let raw of botData.forceChannels) {
      let c = String(raw).trim();
      if (!c.startsWith("@")) c = "@" + c;

      try {
        const member = await bot.getChatMember(c, userId);
        // if user is not a member
        if (!member || member.status === "left" || member.status === "kicked") {
          // send animated join prompt with buttons
          const sent = await bot.sendAnimation(chatId, FORCE_SUB_GIF, {
            caption:
              `😎 <b>Aye Buddy!</b>\n\n` +
              `🚀 <i>File unlock karne se pehle ek chhota sa step...</i>\n\n` +
              `💛 <b>Please join the required channels</b> to continue!\n\n` +
              `✨ <i>Join karlo bro — file turant mil jayegi.</i>`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                ...botData.forceChannels.map((ch) => [
                  {
                    text: `📢 Join ${ch}`,
                    url: `https://t.me/${String(ch).replace("@", "")}`,
                  },
                ]),
                [{ text: "🔄 I Joined, Unlock File", callback_data: "tryagain_" + payload }],
              ],
            },
          });

          // auto delete the join prompt after 25s to reduce clutter
          autoDelete(chatId, sent.message_id, 25000);
          return false;
        }
      } catch (err) {
        // If bot cannot check (not admin or channel invalid), log and continue.
        console.log("checkForceSub getChatMember error:", (err && err.response) ? err.response.body : err);
        // do not block permanently: continue to next channel
      }
    }

    return true;
  }

  // ---------------- send single/batch helper ----------------
  async function deliverFile(chatId, botData, fileData) {
    // single file
    if (fileData.fileId) {
      try {
        if (fileData.type === "photo") {
          const sent = await bot.sendPhoto(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName || "",
            parse_mode: "HTML",
          });
          if (botData.autodel === "enable") {
            const warn = await bot.sendMessage(chatId, "⏳ <b>This file will be deleted in 10 minutes. Save it now!</b>", { parse_mode: "HTML" });
            autoDelete(chatId, warn.message_id, 8000);
            autoDelete(chatId, sent.message_id, 600000);
          }
          return;
        } else if (fileData.type === "video") {
          const sent = await bot.sendVideo(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName || "",
            parse_mode: "HTML",
          });
          if (botData.autodel === "enable") {
            const warn = await bot.sendMessage(chatId, "⏳ <b>This file will be deleted in 10 minutes. Save it now!</b>", { parse_mode: "HTML" });
            autoDelete(chatId, warn.message_id, 8000);
            autoDelete(chatId, sent.message_id, 600000);
          }
          return;
        } else if (fileData.type === "audio") {
          const sent = await bot.sendAudio(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName || "",
            parse_mode: "HTML",
          });
          if (botData.autodel === "enable") {
            const warn = await bot.sendMessage(chatId, "⏳ <b>This file will be deleted in 10 minutes. Save it now!</b>", { parse_mode: "HTML" });
            autoDelete(chatId, warn.message_id, 8000);
            autoDelete(chatId, sent.message_id, 600000);
          }
          return;
        } else {
          const sent = await bot.sendDocument(chatId, fileData.fileId, {
            caption: fileData.caption || fileData.fileName || "",
          });
          if (botData.autodel === "enable") {
            const warn = await bot.sendMessage(chatId, "⏳ <b>This file will be deleted in 10 minutes. Save it now!</b>", { parse_mode: "HTML" });
            autoDelete(chatId, warn.message_id, 8000);
            autoDelete(chatId, sent.message_id, 600000);
          }
          return;
        }
      } catch (err) {
        console.log("deliverFile single send error:", (err && err.response) ? err.response.body : err);
        await bot.sendMessage(chatId, "⚠️ Failed to send file. Try again later.");
        return;
      }
    }

    // batch
    if (fileData.files && fileData.files.length) {
      try {
        const sentIds = [];
        for (const f of fileData.files) {
          const s = await bot.sendDocument(chatId, f.fileId, {
            caption: f.caption || f.fileName || "",
          });
          sentIds.push(s.message_id);
          await new Promise((r) => setTimeout(r, 700));
        }
        const done = await bot.sendMessage(chatId, "📦 All batch files delivered!");
        autoDelete(chatId, done.message_id, 8000);

        if (botData.autodel === "enable") {
          const warn = await bot.sendMessage(chatId, "⏳ <b>These batch files will be deleted in 10 minutes.</b>", { parse_mode: "HTML" });
          autoDelete(chatId, warn.message_id, 8000);
          // schedule deletion of actual files after 10 minutes
          setTimeout(() => {
            sentIds.forEach((id) => bot.deleteMessage(chatId, id).catch(() => {}));
          }, 600000);
        }
      } catch (err) {
        console.log("deliverFile batch send error:", (err && err.response) ? err.response.body : err);
        await bot.sendMessage(chatId, "⚠️ Failed to send batch. Try again later.");
      }
      return;
    }
  }

  // ---------------- /start handler ----------------
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = (msg.from && msg.from.id) ? msg.from.id : null;
    const firstName = (msg.from && msg.from.first_name) ? msg.from.first_name : "there";

    // ensure BotModel exists
    let botData = await BotModel.findOne();
    if (!botData) {
      botData = await BotModel.create({ autodel: "disable", forcesub: "disable", forceChannels: [] });
    }

    const payload = (match && match[1]) ? match[1].trim().replace("?start=", "").replace("start=", "") : "";

    // if owner skip force-sub
    if (Number(userId) !== Number(OWNER_ID)) {
      const ok = await checkForceSub(userId, chatId, payload);
      if (!ok) return; // user shown join prompt already
    }

    // if payload present: deliver file/batch
    if (payload) {
      const fileData = (await FileModel.findOne({ uniqueId: payload })) || (await BatchModel.findOne({ batchId: payload }));
      if (!fileData) {
        return bot.sendMessage(chatId, "❌ Invalid or expired link.");
      }
      return deliverFile(chatId, botData, fileData);
    }

    // default: send START GIF (only GIF as requested)
    try {
      const sent = await bot.sendAnimation(chatId, START_GIF, {
        caption: `Hey <b>${firstName}</b> 😄✨\n\nWelcome to your File Store Bot 🚀\nSend any file & get an instant share link 💫`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "❓ Help", callback_data: "help" }, { text: "ℹ️ About", callback_data: "about" }],
            [{ text: "👨‍💻 Developer", callback_data: "OwnerInfo" }, { text: "📜 Legal", callback_data: "legal" }],
            [{ text: "📢 Update Channel", url: "https://t.me/crunchyroll_hindi_dub_yt" }],
          ],
        },
      });

      // auto delete start GIF after 20s (keeps chat clean)
      autoDelete(chatId, sent.message_id, 20000);
    } catch (err) {
      console.log("start GIF send error:", (err && err.response) ? err.response.body : err);
      // fallback text if animation fails
      await bot.sendMessage(chatId, `Hey ${firstName} 👋\nWelcome to File Store Bot. Send any file to get a share link.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "❓ Help", callback_data: "help" }, { text: "ℹ️ About", callback_data: "about" }],
            [{ text: "👨‍💻 Developer", callback_data: "OwnerInfo" }, { text: "📜 Legal", callback_data: "legal" }],
            [{ text: "📢 Update Channel", url: "https://t.me/crunchyroll_hindi_dub_yt" }],
          ],
        },
      });
    }
  });

  // ---------------- callback handler ----------------
  bot.on("callback_query", async (query) => {
    const data = query.data || "";
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    const userId = query.from?.id;

    // TRY AGAIN / VERIFY flow (user clicked "I Joined, Unlock File")
    if (data.startsWith("tryagain_")) {
      const payload = data.replace("tryagain_", "");
      let botData = await BotModel.findOne();
      if (!botData) return bot.answerCallbackQuery(query.id, { text: "Config missing.", show_alert: true });

      // re-check all channels — if any missing, stop
      for (let raw of botData.forceChannels) {
        let ch = String(raw).trim();
        if (!ch.startsWith("@")) ch = "@" + ch;
        try {
          const member = await bot.getChatMember(ch, userId);
          if (!member || member.status === "left" || member.status === "kicked") {
            return bot.answerCallbackQuery(query.id, { text: "❗ Pehle join kar lo bro!", show_alert: true });
          }
        } catch (err) {
          console.log("tryagain getChatMember error:", (err && err.response) ? err.response.body : err);
          return bot.answerCallbackQuery(query.id, { text: "Error checking channel. Contact owner.", show_alert: true });
        }
      }

      // all good: delete the join prompt message (if exists)
      if (chatId && messageId) bot.deleteMessage(chatId, messageId).catch(() => {});

      // send verify GIF (auto delete)
      try {
        const v = await bot.sendAnimation(chatId, VERIFY_GIF, {
          caption: "🎉 <b>Verified!</b> Unlocking your file... 🔓",
          parse_mode: "HTML",
        });
        autoDelete(chatId, v.message_id, 7000);
      } catch (err) {
        console.log("verify GIF send error:", (err && err.response) ? err.response.body : err);
      }

      // deliver the requested file/batch
      const fileData = (await FileModel.findOne({ uniqueId: payload })) || (await BatchModel.findOne({ batchId: payload }));
      if (!fileData) return bot.sendMessage(chatId, "❌ File expired or removed.");

      return deliverFile(chatId, botData, fileData);
    }

    // MENU buttons (help/about/owner/legal)
    // We'll edit caption of the last message (animation) to show content (editMessageCaption)
    const menuButtons = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "❓ Help", callback_data: "help" }, { text: "ℹ️ About", callback_data: "about" }],
          [{ text: "👨‍💻 Developer", callback_data: "OwnerInfo" }, { text: "📜 Legal", callback_data: "legal" }],
          [{ text: "📢 Update Channel", url: "https://t.me/crunchyroll_hindi_dub_yt" }],
        ],
      },
      parse_mode: "HTML",
    };

    if (data === "help") {
      const HELP = `
<b>🆘 Help Menu</b>

Use this bot to store & share your files.

<b>Commands:</b>
/start
/batch
/finishbatch
/users
/broadcast
`;
      return bot.editMessageCaption(HELP, { chat_id: chatId, message_id: messageId, ...menuButtons }).catch(async () => {
        // fallback: send a new message if edit fails
        return bot.sendMessage(chatId, HELP, menuButtons);
      });
    }

    if (data === "about") {
      const ABOUT = `
<b>ℹ️ About Bot</b>
Name: @${botUsername}
Developer: @crunchyroll_hindi_dub_yt
Tech: NodeJS + MongoDB
`;
      return bot.editMessageCaption(ABOUT, { chat_id: chatId, message_id: messageId, ...menuButtons }).catch(async () => {
        return bot.sendMessage(chatId, ABOUT, menuButtons);
      });
    }

    if (data === "OwnerInfo") {
      const OWNER = `
<b>🌟 Owner Details 🌟</b>
<b>Name:</b> Your Smile
<b>Telegram:</b> @crunchyroll_hindi_dub_yt
`;
      return bot.editMessageCaption(OWNER, { chat_id: chatId, message_id: messageId, ...menuButtons }).catch(async () => {
        return bot.sendMessage(chatId, OWNER, menuButtons);
      });
    }

    if (data === "legal") {
      const LEGAL = `
<b>📜 Legal Notice</b>
Do not upload illegal or copyrighted content.
You are responsible for your files.
`;
      return bot.editMessageCaption(LEGAL, { chat_id: chatId, message_id: messageId, ...menuButtons }).catch(async () => {
        return bot.sendMessage(chatId, LEGAL, menuButtons);
      });
    }

    // default: acknowledge callback
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (e) {}
  });
};
