const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");
const mongoose = require("mongoose");
const express = require("express");
const { BOT_TOKEN, MONGO_URI, OWNER_ID, START_IMAGE_URL } = require("./config");

// MongoDB connection setup
mongoose.set("strictQuery", true);
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// User Schema
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true },
  firstName: String,
  username: String,
  status: { type: String, default: "active" },
  lastInteraction: { type: Date, default: Date.now },
});
const UserModel = mongoose.model("User", userSchema);

// Bot Settings Schema
const botSchema = new mongoose.Schema({
  autodel: { type: String, default: "disable" },
  forcesub: { type: String, default: "disable" },
  forceChannels: { type: [String], default: [] },
});
const BotModel = mongoose.model("BotModel", botSchema);

// File Schema
const fileSchema = new mongoose.Schema({
  uniqueId: String,
  fileId: String,
  type: String,
  fileName: String,
  caption: String,
  createdBy: Number,
});
const FileModel = mongoose.model("File", fileSchema);

// Batch Schema
const batchSchema = new mongoose.Schema({
  batchId: String,
  files: [fileSchema],
  createdBy: Number,
});
const BatchModel = mongoose.model("Batch", batchSchema);

// Express + Bot Setup
const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Variables
let isBatchActive = false;
let batchFiles = [];
let currentBatchId = null;
let broadcastMessage = null;
let broadcastType = null;

// Helper
const isOwner = (id) => Number(id) === Number(OWNER_ID);

// MAIN BOT LOADER
bot
  .getMe()
  .then((botInfo) => {
    const botUsername = botInfo.username;
    console.log("Bot Username Loaded:", botUsername);

    // Commands List
    bot.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "batch", description: "Start a batch upload" },
      { command: "finishbatch", description: "Finish the batch" },
      { command: "users", description: "Show users" },
      { command: "broadcast", description: "Broadcast (owner)" },
      { command: "settings", description: "Bot settings" },
      { command: "help", description: "Help" },
      { command: "about", description: "About bot" },
      { command: "legal", description: "Legal terms" },
    ]);

    // ============================================================
    //        SINGLE MESSAGE HANDLER (USER TRACK + FORCE SUB)
    // ============================================================
    bot.on("message", async (msg) => {
      if (!msg || !msg.from) return;

      const userId = msg.from.id;
      const chatId = msg.chat.id;

      // USER TRACKING
      try {
        const { id, first_name, username } = msg.from;
        let user = await UserModel.findOne({ telegramId: id });
        if (!user)
          await new UserModel({ telegramId: id, firstName: first_name, username }).save();
        else {
          user.lastInteraction = Date.now();
          user.status = "active";
          await user.save();
        }
      } catch (err) {}

      // OWNER skip force-sub
      if (isOwner(userId)) return;

      // FORCE SUB CHECK
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
          } catch (e) {}
        }
      }
    });

    // ============================================================
    //                        FILE UPLOAD HANDLERS
    // ============================================================
    bot.on("document", async (msg) => {
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
    });

    // PHOTO
    bot.on("photo", async (msg) => {
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
    });

    // VIDEO
    bot.on("video", async (msg) => {
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
    });

    // AUDIO
    bot.on("audio", async (msg) => {
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
    });

    // BATCH START
    bot.onText(/\/batch/, (msg) => {
      if (!isOwner(msg.from.id)) return;
      isBatchActive = true;
      currentBatchId = crypto.randomBytes(6).toString("hex");
      batchFiles = [];
      bot.sendMessage(msg.from.id, "Batch started!");
    });

    // FINISH BATCH
    bot.onText(/\/finishbatch/, async (msg) => {
      if (!isOwner(msg.from.id)) return;

      if (batchFiles.length === 0)
        return bot.sendMessage(msg.from.id, "Batch empty.");

      await new BatchModel({
        batchId: currentBatchId,
        files: batchFiles,
        createdBy: msg.from.id,
      }).save();

      bot.sendMessage(
        msg.from.id,
        `Batch saved!\nLink: https://t.me/${botUsername}?start=${currentBatchId}`
      );

      isBatchActive = false;
      batchFiles = [];
      currentBatchId = null;
    });

    // USERS
    bot.onText(/\/users/, async (msg) => {
      if (!isOwner(msg.from.id)) return;
      const total = await UserModel.countDocuments();
      bot.sendMessage(msg.chat.id, `Total Users: ${total}`);
    });

    // BROADCAST
    bot.onText(/\/broadcast/, async (msg) => {
      if (!isOwner(msg.from.id)) return;
      if (!msg.reply_to_message) return bot.sendMessage(msg.chat.id, "Reply to a message!");

      const users = await UserModel.find();
      let s = 0,
        f = 0;

      for (let u of users) {
        try {
          await bot.forwardMessage(u.telegramId, msg.chat.id, msg.reply_to_message.message_id);
          s++;
        } catch {
          f++;
        }
      }

      bot.sendMessage(msg.chat.id, `Broadcast done.\nSent: ${s}\nFailed: ${f}`);
    });

    // ============= FORCE SUB CALLBACK CHECK ================
    bot.on("callback_query", async (q) => {
      if (q.data !== "check_force") return;

      const botData = await BotModel.findOne();
      const userId = q.from.id;

      for (const ch of botData.forceChannels) {
        const member = await bot.getChatMember(ch, userId);
        if (member.status === "left" || member.status === "kicked") {
          return bot.answerCallbackQuery(q.id, {
            text: `❗ Join ${ch} first!`,
            show_alert: true,
          });
        }
      }

      bot.answerCallbackQuery(q.id, { text: "✔ Verified" });
    });

    // LOAD COMMAND MODULES
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

    // Server
    app.listen(3000, () => console.log("Bot Running..."));
  })
  .catch((err) => console.error("getMe() failed:", err));
