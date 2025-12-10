// bot.js (FINAL INTEGRATED)
// Features: force-sub + GIFs + auto-delete + batch-from-channel (forward start/end) + bin channel copy (thumbnail safe)
// Replace your existing bot.js with this file.

const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");
const mongoose = require("mongoose");
const express = require("express");
const { BOT_TOKEN, MONGO_URI, OWNER_ID, START_IMAGE_URL } = require("./config");

// ---------------------- MongoDB setup ----------------------
mongoose.set("strictQuery", true);
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// ---------------------- Schemas & Models ----------------------
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true },
  firstName: String,
  username: String,
  status: { type: String, default: "active" },
  lastInteraction: { type: Date, default: Date.now },
});
const UserModel = mongoose.model("User", userSchema);

const botSchema = new mongoose.Schema({
  autodel: { type: String, default: "disable" },
  forcesub: { type: String, default: "disable" },
  forceChannels: { type: [String], default: [] },
  binChatId: { type: mongoose.Schema.Types.Mixed, default: null }, // can store -100... or string
});
const BotModel = mongoose.model("BotModel", botSchema);

const fileSchema = new mongoose.Schema({
  uniqueId: String,
  fileId: String,
  type: String,
  fileName: String,
  caption: String,
  createdBy: Number,
});
const FileModel = mongoose.model("File", fileSchema);

const batchSchema = new mongoose.Schema({
  batchId: String,
  files: [fileSchema],
  createdBy: Number,
});
const BatchModel = mongoose.model("Batch", batchSchema);

// ---------------------- Express + Bot ----------------------
const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ---------------------- Constants ----------------------
// Default/fallback BIN channel ID you gave earlier:
const FALLBACK_BIN_CHAT_ID = -1001476234331; // use BotModel.binChatId if set
const START_GIF = "https://i.gifer.com/4tN0.gif";
const FORCE_SUB_GIF = "https://i.gifer.com/LRP3.gif";
const VERIFY_GIF = "https://i.gifer.com/91Rt.gif";

// In-memory owner batch state (only owner uses it)
const ownerBatchState = {}; // { [ownerId]: { start: null, end: null, channelId: null } }
function resetOwnerState(ownerId) {
  ownerBatchState[ownerId] = { start: null, end: null, channelId: null };
}
resetOwnerState(Number(OWNER_ID));

// helper
const isOwner = (id) => Number(id) === Number(OWNER_ID);

// small delay helper
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------- Get Bot Info and start ----------------------
bot
  .getMe()
  .then(async (botInfo) => {
    const botUsername = botInfo.username || "yoursmile_sharerobot";
    console.log("Bot Username Loaded:", botUsername);

    // register commands (visible in Telegram)
    await bot.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "batch", description: "Start a batch upload (owner)" },
      { command: "finishbatch", description: "Finish the batch (owner)" },
      { command: "users", description: "Show users (owner)" },
      { command: "broadcast", description: "Broadcast (owner)" },
      { command: "settings", description: "Bot settings (owner)" },
      { command: "help", description: "Help" },
      { command: "about", description: "About bot" },
      { command: "legal", description: "Legal terms" },
      { command: "setbin", description: "Set BIN channel id (owner)" },
      { command: "batchids", description: "Create batch by ids (owner)" },
      { command: "resetbatch", description: "Reset batch selection (owner)" },
    ]);

    // ---------------------- Main single message handler ----------------------
    // Tracks users and does force-sub checks
    bot.on("message", async (msg) => {
      try {
        if (!msg || !msg.from) return;
        const userId = msg.from.id;
        const chatId = msg.chat.id;

        // Track user
        try {
          const { id, first_name, username } = msg.from;
          let user = await UserModel.findOne({ telegramId: id });
          if (!user) {
            await new UserModel({ telegramId: id, firstName: first_name, username }).save();
          } else {
            user.lastInteraction = Date.now();
            user.status = "active";
            await user.save();
          }
        } catch (e) {
          console.log("User tracking error:", e);
        }

        // Owner might be using forwarding to create batches; skip force-sub for owner
        if (isOwner(userId)) {
          // but still allow forwarded-from-channel detection below (handled separately)
        } else {
          // Force-sub check for normal users
          try {
            let botData = await BotModel.findOne();
            if (!botData) {
              botData = await BotModel.create({
                autodel: "disable",
                forcesub: "disable",
                forceChannels: [],
              });
            }

            if (botData.forcesub === "enable" && botData.forceChannels.length > 0) {
              for (let ch of botData.forceChannels) {
                if (!ch.startsWith("@")) ch = "@" + ch;
                try {
                  const member = await bot.getChatMember(ch, userId);
                  if (member.status === "left" || member.status === "kicked") {
                    // Send join prompt (with GIF and buttons)
                    return await bot.sendAnimation(chatId, FORCE_SUB_GIF, {
                      caption:
                        `😎 *Hey buddy ${msg.from.first_name || ""}!*\n\n` +
                        `🚀 _File unlock karne se pehle ek chhota sa step hai..._\n\n` +
                        `💛 *Please join our required channels* to continue!\n\n` +
                        `✨ _Join karlo bro, family ka hissa ban jao!_`,
                      parse_mode: "Markdown",
                      reply_markup: {
                        inline_keyboard: [
                          ...botData.forceChannels.map((c) => [
                            { text: `📢 Join ${c}`, url: `https://t.me/${c.replace("@", "")}` },
                          ]),
                          [{ text: "🔄 I Joined, Unlock File", callback_data: "check_force" }],
                        ],
                      },
                    });
                  }
                } catch (er) {
                  // can't get chat member (maybe bot not admin), log and continue (don't block)
                  console.log("getChatMember error (force-sub):", er && er.response ? er.response.body : er);
                }
              }
            }
          } catch (er) {
            console.log("force-sub main error:", er);
          }
        }

        // ---------- Owner forwarded from BIN channel flow ----------
        // If message is forwarded-from-channel and owner forwarded it to the bot — this handler will set start/end
        // forward info available in: msg.forward_from_chat & msg.forward_from_message_id
        try {
          if (msg.forward_from_chat && msg.forward_from_message_id && isOwner(msg.from.id)) {
            const fchat = msg.forward_from_chat;
            const fmid = msg.forward_from_message_id;
            const forwardedFromChatId = fchat.id ?? fchat.chat_id ?? null;

            // determine configured bin chat id
            const botData = (await BotModel.findOne()) || {};
            const binChatId = botData.binChatId ? Number(botData.binChatId) : Number(FALLBACK_BIN_CHAT_ID);

            // ignore forwarded messages not from configured BIN channel
            if (!forwardedFromChatId || Number(forwardedFromChatId) !== Number(binChatId)) {
              // inform owner (only when forwarded from other channel)
              await bot.sendMessage(msg.chat.id, "⚠️ Forwarded message is not from the configured BIN channel. Use the BIN channel messages only.");
              return;
            }

            // owner state
            const st = ownerBatchState[msg.from.id] || { start: null, end: null, channelId: binChatId };

            if (!st.start) {
              st.start = Number(fmid);
              st.channelId = Number(forwardedFromChatId);
              ownerBatchState[msg.from.id] = st;
              await bot.sendMessage(msg.chat.id, `✅ Start message detected: <b>${st.start}</b>\nNow forward the END message from the same channel.`, { parse_mode: "HTML" });
              return;
            }

            if (!st.end) {
              // ensure same channel
              if (Number(forwardedFromChatId) !== Number(st.channelId)) {
                resetOwnerState(msg.from.id);
                await bot.sendMessage(msg.chat.id, "⚠️ Start and End must be from the same BIN channel. Start again.");
                return;
              }

              st.end = Number(fmid);
              ownerBatchState[msg.from.id] = st;
              await bot.sendMessage(msg.chat.id, `🔁 End message detected: <b>${st.end}</b>\nCreating batch from <b>${st.start}</b> to <b>${st.end}</b>. Please wait...`, { parse_mode: "HTML" });

              // start processing range (copy -> save -> create BatchModel)
              const result = await processRangeAndCreateBatch(st.channelId, st.start, st.end, msg.from.id, botUsername);

              if (!result.ok) {
                resetOwnerState(msg.from.id);
                await bot.sendMessage(msg.chat.id, `❌ Batch creation failed: ${result.reason || "no files found"}`, { parse_mode: "HTML" });
                return;
              }

              // success
              const batch = result.batch;
              const shareLink = `https://t.me/${botUsername}?start=${batch.batchId}`;
              await bot.sendMessage(msg.chat.id, `🎉 Batch created successfully!\nTotal files: <b>${batch.files.length}</b>\n🔗 Batch link:\n${shareLink}`, { parse_mode: "HTML" });

              resetOwnerState(msg.from.id);
              return;
            }
          }
        } catch (err) {
          console.log("owner forward-handling error:", err && err.response ? err.response.body : err);
        }
      } catch (err) {
        console.log("message handler global error:", err && err.response ? err.response.body : err);
      }
    });

    // ---------------------- File upload handlers (owner direct uploads) ----------------------
    // These keep compatibility for single-file or batch from owner sending files directly to bot.
    let isBatchActive = false;
    let batchFiles = [];
    let currentBatchId = null;

    bot.on("document", async (msg) => {
      try {
        if (!msg || !msg.document) return;
        const file = {
          fileId: msg.document.file_id,
          type: "document",
          fileName: msg.document.file_name || "File",
          caption: msg.caption || "",
        };

        if (isBatchActive && isOwner(msg.from.id)) {
          batchFiles.push(file);
          return bot.sendMessage(msg.chat.id, "Document added to batch.");
        }

        if (isOwner(msg.from.id)) {
          const id = crypto.randomBytes(6).toString("hex");
          await new FileModel({ uniqueId: id, ...file, createdBy: msg.from.id }).save();
          return bot.sendMessage(msg.chat.id, `Saved! Link: https://t.me/${botUsername}?start=${id}`);
        }
      } catch (e) {
        console.log("document handler err:", e && e.response ? e.response.body : e);
      }
    });

    bot.on("photo", async (msg) => {
      try {
        if (!msg || !msg.photo) return;
        const p = msg.photo[msg.photo.length - 1];
        const file = {
          fileId: p.file_id,
          type: "photo",
          fileName: "Photo",
          caption: msg.caption || "",
        };

        if (isBatchActive && isOwner(msg.from.id)) {
          batchFiles.push(file);
          return bot.sendMessage(msg.chat.id, "Photo added to batch.");
        }

        if (isOwner(msg.from.id)) {
          const id = crypto.randomBytes(6).toString("hex");
          await new FileModel({ uniqueId: id, ...file, createdBy: msg.from.id }).save();
          return bot.sendMessage(msg.chat.id, `Saved! Link: https://t.me/${botUsername}?start=${id}`);
        }
      } catch (e) {
        console.log("photo handler err:", e && e.response ? e.response.body : e);
      }
    });

    bot.on("video", async (msg) => {
      try {
        if (!msg || !msg.video) return;
        const file = {
          fileId: msg.video.file_id,
          type: "video",
          fileName: msg.video.file_name || "Video",
          caption: msg.caption || "",
        };

        if (isBatchActive && isOwner(msg.from.id)) {
          batchFiles.push(file);
          return bot.sendMessage(msg.chat.id, "Video added to batch.");
        }

        if (isOwner(msg.from.id)) {
          const id = crypto.randomBytes(6).toString("hex");
          await new FileModel({ uniqueId: id, ...file, createdBy: msg.from.id }).save();
          return bot.sendMessage(msg.chat.id, `Saved! Link: https://t.me/${botUsername}?start=${id}`);
        }
      } catch (e) {
        console.log("video handler err:", e && e.response ? e.response.body : e);
      }
    });

    bot.on("audio", async (msg) => {
      try {
        if (!msg || !msg.audio) return;
        const file = {
          fileId: msg.audio.file_id,
          type: "audio",
          fileName: msg.audio.file_name || "Audio",
          caption: msg.caption || "",
        };

        if (isBatchActive && isOwner(msg.from.id)) {
          batchFiles.push(file);
          return bot.sendMessage(msg.chat.id, "Audio added to batch.");
        }

        if (isOwner(msg.from.id)) {
          const id = crypto.randomBytes(6).toString("hex");
          await new FileModel({ uniqueId: id, ...file, createdBy: msg.from.id }).save();
          return bot.sendMessage(msg.chat.id, `Saved! Link: https://t.me/${botUsername}?start=${id}`);
        }
      } catch (e) {
        console.log("audio handler err:", e && e.response ? e.response.body : e);
      }
    });

    // ---------------------- Batch commands (owner) ----------------------
    bot.onText(/\/batch/, (msg) => {
      if (!msg.from || !isOwner(msg.from.id)) return;
      isBatchActive = true;
      currentBatchId = crypto.randomBytes(6).toString("hex");
      batchFiles = [];
      bot.sendMessage(msg.from.id, "Batch started! Send files to add or forward channel files to create batch using start/end.");
    });

    bot.onText(/\/finishbatch/, async (msg) => {
      if (!msg.from || !isOwner(msg.from.id)) return;
      if (batchFiles.length === 0) return bot.sendMessage(msg.from.id, "Batch empty.");

      await new BatchModel({ batchId: currentBatchId, files: batchFiles, createdBy: msg.from.id }).save();
      bot.sendMessage(msg.from.id, `Batch saved!\nLink: https://t.me/${botUsername}?start=${currentBatchId}`);
      isBatchActive = false;
      batchFiles = [];
      currentBatchId = null;
    });

    // ---------------------- Users & Broadcast ----------------------
    bot.onText(/\/users/, async (msg) => {
      if (!msg.from || !isOwner(msg.from.id)) return;
      const total = await UserModel.countDocuments();
      bot.sendMessage(msg.chat.id, `Total Users: ${total}`);
    });

    bot.onText(/\/broadcast/, async (msg) => {
      if (!msg.from || !isOwner(msg.from.id)) return;
      if (!msg.reply_to_message) return bot.sendMessage(msg.chat.id, "Reply to a message!");

      const users = await UserModel.find();
      let s = 0, f = 0;
      for (let u of users) {
        try {
          await bot.forwardMessage(u.telegramId, msg.chat.id, msg.reply_to_message.message_id);
          s++;
        } catch (e) {
          f++;
        }
        await delay(120); // small throttle
      }
      bot.sendMessage(msg.chat.id, `Broadcast done.\nSent: ${s}\nFailed: ${f}`);
    });

    // ---------------------- Force-sub callback check ----------------------
    bot.on("callback_query", async (q) => {
      try {
        if (!q || !q.data) return;
        if (q.data !== "check_force" && !q.data.startsWith("tryagain_")) {
          // normal menu handling is in start.js (Commands) - keep callback for check_force only here
        }

        // check_force flow
        if (q.data === "check_force") {
          const botData = await BotModel.findOne();
          if (!botData || !botData.forceChannels || botData.forceChannels.length === 0) {
            return bot.answerCallbackQuery(q.id, { text: "No force-sub configured.", show_alert: true });
          }

          const userId = q.from.id;
          for (const ch of botData.forceChannels) {
            try {
              const member = await bot.getChatMember(ch, userId);
              if (member.status === "left" || member.status === "kicked") {
                return bot.answerCallbackQuery(q.id, { text: `❗ Join ${ch} first!`, show_alert: true });
              }
            } catch (e) {
              return bot.answerCallbackQuery(q.id, { text: "Error checking channel. Contact owner.", show_alert: true });
            }
          }
          return bot.answerCallbackQuery(q.id, { text: "✔ Verified!" });
        }

        // tryagain_ flow (used when owner forwarded start/end or user clicked I Joined -> tryagain)
        if (q.data && q.data.startsWith("tryagain_")) {
          const payload = q.data.replace("tryagain_", "");
          const userId = q.from.id;
          const botData = await BotModel.findOne();
          const channels = (botData && botData.forceChannels) || [];
          for (let ch of channels) {
            try {
              const member = await bot.getChatMember(ch, userId);
              if (member.status === "left" || member.status === "kicked") {
                return bot.answerCallbackQuery(q.id, { text: "❗ Please join all channels first.", show_alert: true });
              }
            } catch (e) {
              return bot.answerCallbackQuery(q.id, { text: "Error verifying. Contact owner.", show_alert: true });
            }
          }

          // all good: delete join message and deliver file if payload present
          try { await bot.deleteMessage(q.message.chat.id, q.message.message_id).catch(()=>{}); } catch(e){}
          // show verify animation (auto-delete after short time)
          await bot.sendAnimation(q.message.chat.id, VERIFY_GIF, { caption: "🎉 Verified! Unlocking file...", parse_mode: "HTML" });
          // then send the file/batch if payload exists (payload can be file uniqueId or batchId)
          if (payload) {
            const fileData = (await FileModel.findOne({ uniqueId: payload })) || (await BatchModel.findOne({ batchId: payload }));
            if (!fileData) return bot.sendMessage(q.message.chat.id, "❌ File expired or removed.");
            if (fileData.fileId) {
              // single
              if (fileData.type === "photo") await bot.sendPhoto(q.message.chat.id, fileData.fileId, { caption: fileData.caption || fileData.fileName });
              else if (fileData.type === "video") await bot.sendVideo(q.message.chat.id, fileData.fileId, { caption: fileData.caption || fileData.fileName });
              else if (fileData.type === "audio") await bot.sendAudio(q.message.chat.id, fileData.fileId, { caption: fileData.caption || fileData.fileName });
              else await bot.sendDocument(q.message.chat.id, fileData.fileId, { caption: fileData.caption || fileData.fileName });
              return bot.answerCallbackQuery(q.id, { text: "✔ File delivered!" });
            }
            if (fileData.files && fileData.files.length > 0) {
              for (const f of fileData.files) {
                await bot.sendDocument(q.message.chat.id, f.fileId, { caption: f.caption || f.fileName });
                await delay(700);
              }
              return bot.answerCallbackQuery(q.id, { text: "✔ Batch delivered!" });
            }
          } else {
            return bot.answerCallbackQuery(q.id, { text: "Verified!" });
          }
        }
      } catch (err) {
        console.log("callback_query main err:", err && err.response ? err.response.body : err);
      }
    });

    // ---------------------- Batch-from-channel worker functions ----------------------
    async function saveFileToDB(obj) {
      const uniqueId = crypto.randomBytes(8).toString("hex");
      const single = new FileModel({
        uniqueId,
        fileId: obj.fileId,
        type: obj.type || "document",
        fileName: obj.fileName || "",
        caption: obj.caption || "",
        createdBy: obj.createdBy || Number(OWNER_ID),
      });
      await single.save();
      return single;
    }

    async function createBatch(filesArray, ownerId) {
      const batchId = crypto.randomBytes(10).toString("hex");
      const batch = new BatchModel({
        batchId,
        files: filesArray,
        createdBy: ownerId,
      });
      await batch.save();
      return batch;
    }

    async function processRangeAndCreateBatch(binChatId, startId, endId, ownerId, botUsernameLocal) {
      const from = Math.min(startId, endId);
      const to = Math.max(startId, endId);
      const savedFiles = [];

      for (let mid = from; mid <= to; mid++) {
        try {
          // copy message to owner (so we get correct file_id & thumbnail)
          const copied = await bot.copyMessage(ownerId, binChatId, mid);
          if (!copied) {
            continue;
          }

          // detect media
          let fileId = null;
          let ftype = null;
          let fname = "";
          let caption = copied.caption || copied.text || "";

          if (copied.document) {
            fileId = copied.document.file_id;
            ftype = "document";
            fname = copied.document.file_name || "";
          } else if (copied.photo) {
            const p = copied.photo[copied.photo.length - 1];
            fileId = p.file_id;
            ftype = "photo";
          } else if (copied.video) {
            fileId = copied.video.file_id;
            ftype = "video";
            fname = copied.video.file_name || "";
          } else if (copied.audio) {
            fileId = copied.audio.file_id;
            ftype = "audio";
            fname = copied.audio.file_name || "";
          } else if (copied.animation) {
            fileId = copied.animation.file_id;
            ftype = "animation";
          } else if (copied.voice) {
            fileId = copied.voice.file_id;
            ftype = "voice";
          } else {
            // non-media: delete copied message and skip
            try { await bot.deleteMessage(ownerId, copied.message_id).catch(()=>{}); } catch(e){}
            continue;
          }

          if (!fileId) {
            try { await bot.deleteMessage(ownerId, copied.message_id).catch(()=>{}); } catch(e){}
            continue;
          }

          // save into DB
          const saved = await saveFileToDB({ fileId, type: ftype, fileName: fname, caption, createdBy: ownerId });
          savedFiles.push({
            uniqueId: saved.uniqueId,
            fileId: saved.fileId,
            type: saved.type,
            fileName: saved.fileName,
            caption: saved.caption,
            createdBy: saved.createdBy,
          });

          // delete the copied message in owner chat to avoid clutter
          try { await bot.deleteMessage(ownerId, copied.message_id).catch(()=>{}); } catch(e){}

          // small delay
          await delay(600);
        } catch (err) {
          console.log(`batch copy failed mid=${mid}:`, err && err.response ? err.response.body : err);
          // continue
        }
      }

      if (savedFiles.length === 0) {
        return { ok: false, reason: "No media found in selected range." };
      }

      const batch = await createBatch(savedFiles, ownerId);
      return { ok: true, batch };
    }

    // ---------------------- Additional Owner Commands: setbin, batchids, resetbatch ----------------------
    bot.onText(/\/setbin (.+)/, async (msg, match) => {
      if (!msg.from || !isOwner(msg.from.id)) return;
      const raw = match[1].trim();
      let botData = await BotModel.findOne();
      if (!botData) botData = await BotModel.create({ autodel: "disable", forcesub: "disable", forceChannels: [] });
      botData.binChatId = raw.startsWith("-100") ? Number(raw) : raw;
      await botData.save();
      bot.sendMessage(msg.from.id, `BIN chat id saved: ${botData.binChatId}`);
    });

    bot.onText(/\/batchids (\-?\d+) (\-?\d+)/, async (msg, match) => {
      if (!msg.from || !isOwner(msg.from.id)) return;
      const s = Number(match[1]);
      const e = Number(match[2]);
      const botData = (await BotModel.findOne()) || {};
      const binId = botData.binChatId || FALLBACK_BIN_CHAT_ID;
      await bot.sendMessage(msg.from.id, `Processing ${s} -> ${e} from ${binId}. This may take some time...`);
      const res = await processRangeAndCreateBatch(binId, s, e, msg.from.id, botUsername);
      if (!res.ok) return bot.sendMessage(msg.from.id, `Failed: ${res.reason || "no media found"}`);
      const shareLink = `https://t.me/${botUsername}?start=${res.batch.batchId}`;
      return bot.sendMessage(msg.from.id, `✅ Batch done. Link: ${shareLink}`);
    });

    bot.onText(/\/resetbatch/, async (msg) => {
      if (!msg.from || !isOwner(msg.from.id)) return;
      resetOwnerState(msg.from.id);
      bot.sendMessage(msg.from.id, "Batch start/end state reset. Forward start message again when ready.");
    });

    // ---------------------- Load existing Commands folder (start/settings/disclaimer) ----------------------
    try {
      require("./Commands/commands.js")(
        app,
        bot,
        UserModel,
        OWNER_ID,
        BotModel,
        botUsername,
        START_IMAGE_URL,
        FileModel,
        BatchModel
      );
    } catch (e) {
      console.log("Failed to load Command modules:", e && e.stack ? e.stack : e);
    }

    // ---------------------- Start Express server ----------------------
    app.listen(process.env.PORT || 3000, () => console.log("Bot Running..."));
  })
  .catch((err) => console.error("getMe() failed:", err));

// ---------------------- End of bot.js ----------------------
