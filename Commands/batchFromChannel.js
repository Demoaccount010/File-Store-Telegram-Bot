// Commands/batchFromChannel.js
const crypto = require("crypto");

module.exports = function (
  app,
  bot,
  UserModel,
  OWNER_ID,
  BotModel,
  FileModel,
  BatchModel,
  BOT_USERNAME = "@yoursmile_sharerobot"
) {
  // If you prefer to set BIN_CHAT_ID in BotModel you can.
  // But we'll allow both: prefer BotModel.binChatId, else fallback to constant:
  const FALLBACK_BIN_CHAT_ID = -1001476234331; // <- your provided id

  // in-memory state for owner batch selection (safe because only owner uses it)
  // Structure: { ownerId: { start: number|null, end: number|null, channelId: number|null } }
  const ownerBatchState = {};

  function resetOwnerState(ownerId) {
    ownerBatchState[ownerId] = { start: null, end: null, channelId: null };
  }

  // Initialize owner state
  resetOwnerState(OWNER_ID);

  // helper: save single file into DB
  async function saveFileToDB(obj) {
    // obj: { fileId, type, fileName, caption, createdBy }
    const uniqueId = crypto.randomBytes(8).toString("hex");
    const single = new FileModel({
      uniqueId,
      fileId: obj.fileId,
      type: obj.type || "document",
      fileName: obj.fileName || "",
      caption: obj.caption || "",
      createdBy: obj.createdBy || OWNER_ID,
    });
    await single.save();
    return single;
  }

  // helper: create batch record
  async function createBatch(filesArray, ownerId) {
    const batchId = crypto.randomBytes(10).toString("hex");
    const batch = new BatchModel({
      batchId,
      files: filesArray, // array of fileSchema (fileId,type,fileName,caption,createdBy)
      createdBy: ownerId,
    });
    await batch.save();
    return batch;
  }

  // core worker: iterate start..end on BIN channel and copy each message to owner, extract file info, save into DB
  async function processRangeAndCreateBatch(binChatId, startId, endId, ownerId) {
    // safety: ensure integers & order
    let from = Math.min(startId, endId);
    let to = Math.max(startId, endId);

    const savedFiles = [];

    // For rate-limit safety: small delay
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    for (let mid = from; mid <= to; mid++) {
      try {
        // copy message from BIN channel to owner (this returns the copied message object)
        // copyMessage(targetChatId, fromChatId, messageId)
        const copied = await bot.copyMessage(ownerId, binChatId, mid);

        // If copy failed, bot.copyMessage would throw; if message has no media, copied will be message text -> we can skip non-media messages
        if (!copied) {
          // nothing copied
          continue;
        }

        // determine file id + type + filename + caption
        let fileId = null;
        let ftype = null;
        let fname = "";
        let caption = copied.caption || copied.text || "";

        if (copied.document) {
          fileId = copied.document.file_id;
          ftype = "document";
          fname = copied.document.file_name || "";
        } else if (copied.photo) {
          // choose largest size
          const p = copied.photo[copied.photo.length - 1];
          fileId = p.file_id;
          ftype = "photo";
          fname = "";
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
          fname = copied.animation.file_name || "";
        } else if (copied.voice) {
          fileId = copied.voice.file_id;
          ftype = "voice";
          fname = "";
        } else {
          // Not a media message (text only) — skip or store as text file? we'll skip
          // delete the copied message to avoid clutter
          try { await bot.deleteMessage(ownerId, copied.message_id).catch(()=>{}); } catch(e){}
          continue;
        }

        if (!fileId) {
          // delete copied message and continue
          try { await bot.deleteMessage(ownerId, copied.message_id).catch(()=>{}); } catch(e){}
          continue;
        }

        // Save file into DB (this stores a new file entry with a fresh uniqueId)
        const saved = await saveFileToDB({
          fileId,
          type: ftype,
          fileName: fname,
          caption,
          createdBy: ownerId,
        });

        // push entry in simple format for batch array (store necessary fields)
        savedFiles.push({
          uniqueId: saved.uniqueId,
          fileId: saved.fileId,
          type: saved.type,
          fileName: saved.fileName,
          caption: saved.caption,
          createdBy: saved.createdBy,
        });

        // delete copied message in owner chat to keep clean
        try { await bot.deleteMessage(ownerId, copied.message_id).catch(()=>{}); } catch(e){}

        // tiny delay to avoid flood / rate-limit
        await delay(600);
      } catch (err) {
        // if a particular message id doesn't exist (deleted or gap), skip and continue
        // log for debugging but don't stop entire batch
        console.log(`batch copy failed mid=${mid}:`, err && err.response ? err.response.body : err);
        // continue silently
      }
    }

    // After iterating, create batch if savedFiles not empty
    if (savedFiles.length === 0) {
      return { ok: false, reason: "No media found in selected range." };
    }

    const batch = await createBatch(savedFiles, ownerId);
    return { ok: true, batch };
  }

  // Handler: catch forwarded messages from BIN channel (owner forwards start & end)
  bot.on("message", async (msg) => {
    try {
      // only owner used for batch setup
      if (!msg.from) return;
      const userId = msg.from.id;
      if (userId !== OWNER_ID) return;

      // We need forwarded messages from the BIN channel.
      // A forwarded message from channel will have: msg.forward_from_chat and msg.forward_from_message_id (or for older versions forward_from)
      const fchat = msg.forward_from_chat || (msg.forward_from && msg.forward_from.type === "channel" ? msg.forward_from : null);
      const fmid = msg.forward_from_message_id || msg.forward_from_message_id; // some libs use same prop

      // If message isn't a forwarded-from-channel, ignore (owner can still send other commands)
      if (!fchat || typeof fmid === "undefined") return;

      // identify bin chat id (prefer BotModel stored value)
      let botData = await BotModel.findOne();
      let binChatId = FALLBACK_BIN_CHAT_ID;
      if (botData && botData.binChatId) {
        binChatId = botData.binChatId;
      }

      // If forwarded message not from configured BIN channel, ignore (or inform)
      const forwardedFromChatId = fchat.id ?? fchat.chat_id ?? null;
      if (Number(forwardedFromChatId) !== Number(binChatId)) {
        // optional: give feedback
        await bot.sendMessage(userId, "⚠️ Forwarded message is not from configured BIN channel. Forward messages from your BIN channel only.");
        return;
      }

      // Owner forwarded a message from BIN channel. If ownerBatchState has no start -> set start, else set end and process batch.
      const state = ownerBatchState[userId] || { start: null, end: null, channelId: binChatId };

      if (!state.start) {
        state.start = Number(fmid);
        state.channelId = Number(forwardedFromChatId);
        ownerBatchState[userId] = state;
        await bot.sendMessage(userId, `✅ Start message detected: <b>${state.start}</b>\nNow forward the END message (the last message of your batch) from the same channel.`, { parse_mode: "HTML" });
        return;
      }

      if (!state.end) {
        // ensure same channel
        if (Number(forwardedFromChatId) !== Number(state.channelId)) {
          // different channel forwarded — reset
          resetOwnerState(userId);
          await bot.sendMessage(userId, "⚠️ Start and End messages must be from the same BIN channel. Please start again.");
          return;
        }

        state.end = Number(fmid);
        ownerBatchState[userId] = state;

        await bot.sendMessage(userId, `🔁 End message detected: <b>${state.end}</b>\nCreating batch from <b>${state.start}</b> to <b>${state.end}</b>. Please wait...`, { parse_mode: "HTML" });

        // process range
        const result = await processRangeAndCreateBatch(state.channelId, state.start, state.end, userId);

        if (!result.ok) {
          resetOwnerState(userId);
          await bot.sendMessage(userId, `❌ Batch creation failed: ${result.reason || "no files found"}\nPlease try again or check the channel messages.`, { parse_mode: "HTML" });
          return;
        }

        // success: give owner the link
        const batch = result.batch;
        const shareLink = `https://t.me/${BOT_USERNAME.replace("@","")}?start=${batch.batchId}`;

        await bot.sendMessage(userId, `🎉 Batch created successfully!\nTotal files: <b>${batch.files.length}</b>\n🔗 Batch link: ${shareLink}`, { parse_mode: "HTML" });

        // clear state
        resetOwnerState(userId);
        return;
      }

      // fallback
    } catch (err) {
      console.log("batchFromChannel handler error:", err && err.response ? err.response.body : err);
    }
  });

  // Extra command: if owner wants to reset manualy
  bot.onText(/\/resetbatch/, async (msg) => {
    if (!msg.from) return;
    if (msg.from.id !== OWNER_ID) return;
    resetOwnerState(OWNER_ID);
    bot.sendMessage(OWNER_ID, "Batch start/end state reset. Forward start message again when ready.");
  });

  // Admin helper to set binChatId into BotModel (optional)
  bot.onText(/\/setbin (.+)/, async (msg, match) => {
    if (!msg.from || msg.from.id !== OWNER_ID) return;
    const raw = match[1].trim();
    let botData = await BotModel.findOne();
    if (!botData) botData = await BotModel.create({ autodel: "disable", forcesub: "disable", forceChannels: [] });
    botData.binChatId = raw.startsWith("-100") ? Number(raw) : raw;
    await botData.save();
    bot.sendMessage(OWNER_ID, `BIN chat id saved: ${botData.binChatId}`);
  });

  // If you want, expose a command to create a batch by explicit ids
  bot.onText(/\/batchids (\-?\d+) (\-?\d+)/, async (msg, match) => {
    if (!msg.from || msg.from.id !== OWNER_ID) return;
    const s = Number(match[1]);
    const e = Number(match[2]);
    const botData = (await BotModel.findOne()) || {};
    const binId = botData.binChatId || FALLBACK_BIN_CHAT_ID;
    await bot.sendMessage(OWNER_ID, `Processing ${s} -> ${e} from ${binId}. This may take some time...`);
    const res = await processRangeAndCreateBatch(binId, s, e, OWNER_ID);
    if (!res.ok) return bot.sendMessage(OWNER_ID, `Failed: ${res.reason || "no media found"}`);
    const shareLink = `https://t.me/${BOT_USERNAME.replace("@","")}?start=${res.batch.batchId}`;
    return bot.sendMessage(OWNER_ID, `✅ Batch done. Link: ${shareLink}`);
  });
};
