// ====================== bot.js (FINAL CLEAN VERSION) ======================
// Features:
// ForceSub + GIF + TryAgain
// Auto Delete
// Single File Store
// Batch (Normal only, no bin)
// Broadcast
// commands.js integration

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

// GIFs
const START_GIF = "https://i.gifer.com/4tN0.gif";
const FORCE_SUB_GIF = "https://i.gifer.com/LRP3.gif";
const VERIFY_GIF = "https://i.gifer.com/91Rt.gif";

const isOwner = (id) => Number(id) === Number(OWNER_ID);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------- Bot Init ----------------------
bot
  .getMe()
  .then(async (botInfo) => {
    const botUsername = botInfo.username;
    console.log("Bot Username Loaded:", botUsername);

    await bot.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "batch", description: "Start batch (owner)" },
      { command: "finishbatch", description: "Finish batch (owner)" },
      { command: "users", description: "Show users (owner)" },
      { command: "broadcast", description: "Broadcast message (owner)" },
      { command: "settings", description: "Bot Settings" },
      { command: "help", description: "Help" },
      { command: "about", description: "About" },
      { command: "legal", description: "Legal" }
    ]);

    // ---------------------- MESSAGE HANDLER ----------------------
    bot.on("message", async (msg) => {
      try {
        if (!msg || !msg.from) return;

        const userId = msg.from.id;
        const chatId = msg.chat.id;

        // save user
        let user = await UserModel.findOne({ telegramId: userId });
        if (!user)
          await UserModel.create({
            telegramId: userId,
            firstName: msg.from.first_name,
            username: msg.from.username,
          });
        else {
          user.lastInteraction = Date.now();
          user.status = "active";
          await user.save();
        }

        // owner skip force-sub
        if (isOwner(userId)) return;

        let botData = await BotModel.findOne();
        if (!botData)
          botData = await BotModel.create({
            autodel: "disable",
            forcesub: "disable",
            forceChannels: [],
          });

        // ----- Force Sub Check -----
        if (botData.forcesub === "enable" && botData.forceChannels.length > 0) {
          for (let ch of botData.forceChannels) {
            try {
              if (!ch.startsWith("@")) ch = "@" + ch;
              const member = await bot.getChatMember(ch, userId);

              if (member.status === "left" || member.status === "kicked") {
                return bot.sendAnimation(chatId, FORCE_SUB_GIF, {
                  caption:
                    `😎 *Hey buddy ${msg.from.first_name}!*\n\n` +
                    `🚀 _Please join our required channels first!_`,
                  parse_mode: "Markdown",
                  reply_markup: {
                    inline_keyboard: [
                      ...botData.forceChannels.map((c) => [
                        { text: `📢 Join ${c}`, url: `https://t.me/${c.replace("@", "")}` },
                      ]),
                      [{ text: "I Joined ✔", callback_data: "check_force" }],
                    ],
                  },
                });
              }
            } catch {}
          }
        }
      } catch (e) {
        console.log("message handler error:", e);
      }
    });

    // ---------------------- OWNER FILE UPLOAD HANDLERS ----------------------
    let isBatchActive = false;
    let batchFiles = [];
    let currentBatchId = null;

    // DOCUMENT
    bot.on("document", async (msg) => {
      if (!msg.document) return;
      if (!isOwner(msg.from.id)) return;
      const file = {
        fileId: msg.document.file_id,
        type: "document",
        fileName: msg.document.file_name,
        caption: msg.caption || "",
      };

      if (isBatchActive) {
        batchFiles.push(file);
        return bot.sendMessage(msg.chat.id, "Document added to batch.");
      }

      const id = crypto.randomBytes(6).toString("hex");
      await FileModel.create({ uniqueId: id, ...file, createdBy: msg.from.id });
      bot.sendMessage(msg.chat.id, `Saved! Link: https://t.me/${botUsername}?start=${id}`);
    });

    // PHOTO
    bot.on("photo", async (msg) => {
      if (!msg.photo) return;
      if (!isOwner(msg.from.id)) return;
      const p = msg.photo[msg.photo.length - 1];
      const file = {
        fileId: p.file_id,
        type: "photo",
        fileName: "Photo",
        caption: msg.caption || "",
      };

      if (isBatchActive) {
        batchFiles.push(file);
        return bot.sendMessage(msg.chat.id, "Photo added to batch.");
      }

      const id = crypto.randomBytes(6).toString("hex");
      await FileModel.create({ uniqueId: id, ...file, createdBy: msg.from.id });
      bot.sendMessage(msg.chat.id, `Saved! Link: https://t.me/${botUsername}?start=${id}`);
    });

    // VIDEO
    bot.on("video", async (msg) => {
      if (!msg.video) return;
      if (!isOwner(msg.from.id)) return;
      const file = {
        fileId: msg.video.file_id,
        type: "video",
        fileName: msg.video.file_name,
        caption: msg.caption || "",
      };

      if (isBatchActive) {
        batchFiles.push(file);
        return bot.sendMessage(msg.chat.id, "Video added to batch.");
      }

      const id = crypto.randomBytes(6).toString("hex");
      await FileModel.create({ uniqueId: id, ...file, createdBy: msg.from.id });
      bot.sendMessage(msg.chat.id, `Saved! Link: https://t.me/${botUsername}?start=${id}`);
    });

    // AUDIO
    bot.on("audio", async (msg) => {
      if (!msg.audio) return;
      if (!isOwner(msg.from.id)) return;
      const file = {
        fileId: msg.audio.file_id,
        type: "audio",
        fileName: msg.audio.file_name,
        caption: msg.caption || "",
      };

      if (isBatchActive) {
        batchFiles.push(file);
        return bot.sendMessage(msg.chat.id, "Audio added to batch.");
      }

      const id = crypto.randomBytes(6).toString("hex");
      await FileModel.create({ uniqueId: id, ...file, createdBy: msg.from.id });
      bot.sendMessage(msg.chat.id, `Saved! Link: https://t.me/${botUsername}?start=${id}`);
    });

    // ---------------------- BATCH CMD ----------------------
    bot.onText(/\/batch/, (msg) => {
      if (!isOwner(msg.from.id)) return;
      isBatchActive = true;
      batchFiles = [];
      currentBatchId = crypto.randomBytes(6).toString("hex");
      bot.sendMessage(msg.chat.id, "Batch started! Send files now.");
    });

    bot.onText(/\/finishbatch/, async (msg) => {
      if (!isOwner(msg.from.id)) return;

      if (batchFiles.length === 0)
        return bot.sendMessage(msg.chat.id, "Batch empty.");

      await BatchModel.create({
        batchId: currentBatchId,
        files: batchFiles,
        createdBy: msg.from.id,
      });

      bot.sendMessage(
        msg.chat.id,
        `Batch saved!\nLink: https://t.me/${botUsername}?start=${currentBatchId}`
      );

      isBatchActive = false;
      batchFiles = [];
      currentBatchId = null;
    });

    // ---------------------- USERS CMD ----------------------
    bot.onText(/\/users/, async (msg) => {
      if (!isOwner(msg.from.id)) return;
      const total = await UserModel.countDocuments();
      bot.sendMessage(msg.chat.id, `Total Users: ${total}`);
    });

    // ---------------------- BROADCAST ----------------------
    bot.onText(/\/broadcast/, async (msg) => {
      if (!isOwner(msg.from.id)) return;
      if (!msg.reply_to_message)
        return bot.sendMessage(msg.chat.id, "Reply to a message!");

      const users = await UserModel.find();
      let ok = 0,
        fail = 0;

      for (const u of users) {
        try {
          await bot.forwardMessage(
            u.telegramId,
            msg.chat.id,
            msg.reply_to_message.message_id
          );
          ok++;
        } catch {
          fail++;
        }
        await delay(100);
      }

      bot.sendMessage(
        msg.chat.id,
        `Broadcast completed.\nSuccess: ${ok}\nFailed: ${fail}`
      );
    });

    // ---------------------- FORCE-SUB CALLBACK ----------------------
    bot.on("callback_query", async (q) => {
      if (!q.data) return;

      if (q.data === "check_force") {
        const userId = q.from.id;
        const botData = await BotModel.findOne();

        for (const ch of botData.forceChannels) {
          try {
            const m = await bot.getChatMember(ch, userId);
            if (m.status === "left" || m.status === "kicked")
              return bot.answerCallbackQuery(q.id, {
                text: `❗ Join ${ch} first`,
                show_alert: true,
              });
          } catch {}
        }

        bot.answerCallbackQuery(q.id, { text: "✔ Verified!" });

        // Auto delete join menu
        try {
          bot.deleteMessage(q.message.chat.id, q.message.message_id);
        } catch {}
      }
    });

    // ---------------------- Commands folder ----------------------
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

    // ---------------------- Start Server ----------------------
    app.listen(3000, () => console.log("Bot Running..."));
  })
  .catch((err) => console.error("Bot failed:", err));
