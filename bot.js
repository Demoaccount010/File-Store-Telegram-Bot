const TelegramBot = require("node-telegram-bot-api");
const crypto = require("crypto");
const mongoose = require("mongoose");
const express = require("express");
const { BOT_TOKEN, MONGO_URI, OWNER_ID, START_IMAGE_URL } = require("./config");
// MongoDB connection setup

mongoose.set('strictQuery', true); // or false, depending on your preference
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Schema for users
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true },
  firstName: String,
  username: String,
  status: { type: String, default: "active" },
  lastInteraction: { type: Date, default: Date.now },
});

const UserModel = mongoose.model("User", userSchema);

// bot data schema (UPDATED: added forcesub + forceChannels)
const botSchema = new mongoose.Schema({
  autodel: { type: String, default: "disable" },
  forcesub: { type: String, default: "disable" }, // NEW
  forceChannels: { type: [String], default: [] }, // NEW
});

const BotModel = mongoose.model("BotModel", botSchema);

// Schema for batch and single files
const fileSchema = new mongoose.Schema({
  uniqueId: String,
  fileId: String,
  type: String,
  fileName: String,
  caption: String,
  createdBy: Number,
});

const batchSchema = new mongoose.Schema({
  batchId: String,
  files: [fileSchema],
  createdBy: Number,
});

const FileModel = mongoose.model("File", fileSchema);
const BatchModel = mongoose.model("Batch", batchSchema);

// Bot setup
const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let isBatchActive = false;
let batchFiles = [];
let currentBatchId = null;

// Variable to temporarily store broadcast message
let broadcastMessage = null;
let broadcastType = null;

// Helper function to check if the user is the owner (numeric compare)
const isOwner = (userId) => Number(userId) === Number(OWNER_ID);

// Get bot information asynchronously
bot
  .getMe()
  .then((botInfo) => {
    // Now we have the botInfo object
    const botUsername = botInfo.username;

    bot.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "batch", description: "Start a batch upload" },
      { command: "finishbatch", description: "Finish current batch" },
      { command: "users", description: "Show all users (owner only)" },
      { command: "broadcast", description: "Broadcast message (owner only)" },
      { command: "settings", description: "Bot Settings (owner only)" },
      { command: "help", description: "Show help information" },
      { command: "about", description: "About this bot" },
      { command: "legal", description: "Legal disclaimer & usage terms" },
    ]);

    // ========== FINAL MERGED MESSAGE HANDLER (USER TRACKING + FORCE SUB) ==========
    // Replaces previous separate message handlers to avoid duplicate listeners.
    bot.on("message", async (msg) => {
      // basic guards
      if (!msg || !msg.from) return;
      const userId = msg.from.id;
      const chatId = msg.chat && msg.chat.id ? msg.chat.id : userId;

      // -------------------- USER TRACKING --------------------
      try {
        const { id: telegramId, first_name: firstName, username } = msg.from;
        let user = await UserModel.findOne({ telegramId });

        if (!user) {
          user = new UserModel({ telegramId, firstName, username });
          await user.save();
        } else {
          user.lastInteraction = Date.now();
          user.status = "active";
          await user.save();
        }
      } catch (e) {
        console.log("User tracking error:", e);
      }

      // OWNER skip for force-sub checks (owner should not be blocked)
      if (Number(userId) === Number(OWNER_ID)) return;

      // -------------------- FORCE SUB CHECK --------------------
      try {
        // load or create botData (safe)
        let botData = await BotModel.findOne();
        if (!botData) {
          botData = await BotModel.create({
            autodel: "disable",
            forcesub: "disable",
            forceChannels: [],
          });
        }

        // if forcesub not enabled -> just continue (do not block)
        if (botData.forcesub !== "enable") return;

        // if no channels configured -> don't block (owner probably forgot to add channels)
        if (!botData.forceChannels || botData.forceChannels.length === 0) return;

        // Check membership for each channel; if any channel not joined -> prompt and stop further processing
        for (const channel of botData.forceChannels) {
          try {
            // ensure channel string starts with @ when calling getChatMember
            const channelForApi = channel.startsWith("@") ? channel : `@${channel}`;
            const member = await bot.getChatMember(channelForApi, userId);

            if (member.status === "left" || member.status === "kicked") {
              // prompt user to join all channels; show buttons for each channel + an "I Joined" button
              return bot.sendMessage(chatId, "⚠️ Please join required channels to continue!", {
                reply_markup: {
                  inline_keyboard: [
                    ...botData.forceChannels.map((ch) => [
                      {
                        text: `Join ${ch.startsWith("@") ? ch : "@" + ch}`,
                        url: `https://t.me/${(ch.startsWith("@") ? ch.slice(1) : ch)}`,
                      },
                    ]),
                    [{ text: "I Joined ✔️", callback_data: "check_force" }],
                  ],
                },
              });
            }
          } catch (errInner) {
            // If getChatMember fails (invalid channel, bot not admin, etc.), log but continue to next channel
            console.log("Force-sub check error (channel):", channel, errInner && errInner.response ? errInner.response.body : errInner);
            // If channel is invalid, skip checking it (owner should remove it)
            continue;
          }
        }

        // if all channels OK -> allow normal flow (no return)
      } catch (err) {
        console.log("Force-sub main error:", err);
      }
    });

    // Function to delete the message from user's chat after a specified timeout (kept as comment)
    /*    const deleteMessageAfterTimeout = async (chatId, messageId, timeout) => {
      setTimeout(async () => {
        try {
          await bot.telegram.deleteMessage(chatId, messageId);
          console.log(
            `Message with ID ${messageId} deleted from chat ${chatId}.`
          );
        } catch (error) {
          console.error(
            `Failed to delete message with ID ${messageId}:`,
            error
          );
        }
      }, timeout);
    }; */

    // Command to start a batch
    bot.onText(/\/batch/, (msg) => {
      const chatId = msg.from.id;

      // Check if the user is the owner
      if (!isOwner(chatId)) {
        bot.sendMessage(chatId, "Only the owner can start a batch.");
        return;
      }

      // Start a new batch
      isBatchActive = true;
      currentBatchId = crypto.randomBytes(8).toString("hex");
      batchFiles = [];

      // Inform the user that the batch has started
      bot.sendMessage(chatId, "Batch started! Send files for the batch.");
    });

    // Handle document uploads
    bot.on("document", async (msg) => {
      const file = {
        fileId: msg.document.file_id,
        type: "document",
        fileName: msg.document.file_name || "File",
        caption: msg.caption || "",
      };

      if (isBatchActive && isOwner(msg.from.id)) {
        batchFiles.push(file);
        bot.sendMessage(
          msg.chat.id,
          "File added to the batch.\n\nSend next file or click /finishbatch for End and Get batch link"
        );
      } else if (!isBatchActive && isOwner(msg.from.id)) {
        const uniqueId = crypto.randomBytes(8).toString("hex");
        const singleFile = new FileModel({
          uniqueId,
          ...file,
          createdBy: msg.from.id,
        });

        await singleFile.save();
        const shareLink = `https://t.me/Hjstreambot?start=${uniqueId}`;
        bot.sendMessage(
          msg.chat.id,
          `File saved! Shareable link: ${shareLink}`
        );
      }
    });

    // Handle photos
    bot.on("photo", async (msg) => {
      const photoSizes = msg.photo;
      const largestPhoto = photoSizes[photoSizes.length - 1]; // choose highest resolution photo

      const file = {
        fileId: largestPhoto.file_id,
        type: "photo",
        fileName: "Photo",
        caption: msg.caption || "",
      };

      if (isBatchActive && isOwner(msg.from.id)) {
        batchFiles.push(file);
        bot.sendMessage(
          msg.chat.id,
          "Photo added to the batch.\n\nSend next file or click /finishbatch for End and Get batch link."
        );
      } else if (!isBatchActive && isOwner(msg.from.id)) {
        const uniqueId = crypto.randomBytes(8).toString("hex");
        const singleFile = new FileModel({
          uniqueId,
          ...file,
          createdBy: msg.from.id,
        });

        await singleFile.save();
        const shareLink = `https://t.me/Hjstreambot?start=${uniqueId}`;
        bot.sendMessage(
          msg.chat.id,
          `File saved! Shareable link: ${shareLink}`
        );
      }
    });

    // Handle video uploads
    bot.on("video", async (msg) => {
      const file = {
        fileId: msg.video.file_id,
        type: "video",
        fileName: msg.video.file_name || "Video",
        caption: msg.caption || "",
      };

      if (isBatchActive && isOwner(msg.from.id)) {
        batchFiles.push(file);
        bot.sendMessage(
          msg.chat.id,
          "Video added to the batch.\n\nSend next file or click /finishbatch for End and Get batch link"
        );
      } else if (!isBatchActive && isOwner(msg.from.id)) {
        const uniqueId = crypto.randomBytes(8).toString("hex");
        const singleFile = new FileModel({
          uniqueId,
          ...file,
          createdBy: msg.from.id,
        });

        await singleFile.save();
        const shareLink = `https://t.me/Hjstreambot?start=${uniqueId}`;
        bot.sendMessage(
          msg.chat.id,
          `Video saved! Shareable link: ${shareLink}`
        );
      }
    });

    // Handle audio uploads
    bot.on("audio", async (msg) => {
      const file = {
        fileId: msg.audio.file_id,
        type: "audio",
        fileName: msg.audio.file_name || "Audio",
        caption: msg.caption || "",
      };

      if (isBatchActive && isOwner(msg.from.id)) {
        batchFiles.push(file);
        bot.sendMessage(
          msg.chat.id,
          "Audio added to the batch.\n\nSend next file or click /finishbatch for End and Get batch link."
        );
      } else if (!isBatchActive && isOwner(msg.from.id)) {
        const uniqueId = crypto.randomBytes(8).toString("hex");
        const singleFile = new FileModel({
          uniqueId,
          ...file,
          createdBy: msg.from.id,
        });

        await singleFile.save();
        const shareLink = `https://t.me/Hjstreambot?start=${uniqueId}`;
        bot.sendMessage(
          msg.chat.id,
          `Audio saved! Shareable link: ${shareLink}`
        );
      }
    });

    // Command to finish the batch
    bot.onText(/\/finishbatch/, async (msg) => {
      const telegramId = msg.from.id;

      // Check if the user is the owner
      if (!isOwner(telegramId)) {
        bot.sendMessage(msg.chat.id, "Only the owner can finish the batch.");
        return;
      }

      // Check if the batch is active and has files
      if (isBatchActive && batchFiles.length > 0) {
        // Save the batch data to the database
        const batchData = new BatchModel({
          batchId: currentBatchId,
          files: batchFiles,
          createdBy: telegramId,
        });
        await batchData.save();

        // Generate the shareable link
        const shareLink = `https://t.me/${botUsername}?start=${currentBatchId}`;
        bot.sendMessage(
          msg.chat.id,
          `Batch saved successfully! Shareable link: ${shareLink}`
        );

        // Reset batch-related variables
        isBatchActive = false;
        batchFiles = [];
        currentBatchId = null;
      } else {
        bot.sendMessage(
          msg.chat.id,
          "No active batch or no files have been added."
        );
      }
    });

    // Command to show users data
    bot.onText(/\/users/, async (msg) => {
      const telegramId = msg.from.id;

      // Check if the user is the owner
      if (!isOwner(telegramId)) {
        return bot.sendMessage(
          msg.chat.id,
          "Only the owner can use this command."
        );
      }

      // Fetch all users from the database
      const users = await UserModel.find();
      let activeUsers = 0;
      let blockedUsers = 0;
      let deletedUsers = 0;

      // Check each user's status
      for (const user of users) {
        try {
          const chat = await bot.getChat(user.telegramId);
          if (chat && chat.id) {
            activeUsers++;
          }
        } catch (error) {
          if (error.response && error.response.error_code === 400) {
            deletedUsers++;
            user.status = "deleted";
            await user.save();
          } else if (error.response && error.response.error_code === 403) {
            blockedUsers++;
            user.status = "blocked";
            await user.save();
          }
        }
      }

      const totalUsers = users.length;

      // Send a summary of users
      bot.sendMessage(
        msg.chat.id,
        `👥 Total Users: ${totalUsers}\n✅ Active Users: ${activeUsers}\n🚫 Blocked Users: ${blockedUsers}\n❌ Deleted Accounts: ${deletedUsers}`
      );
    });

    // Handle broadcast command
    bot.onText(/\/broadcast/, async (msg) => {
      const telegramId = msg.from.id;

      // Check if the user is the owner
      if (!isOwner(telegramId)) {
        return bot.sendMessage(
          msg.chat.id,
          "Only the owner can use this command."
        );
      }

      // Check if the command is a reply to a message
      if (!msg.reply_to_message) {
        return bot.sendMessage(
          msg.chat.id,
          "Please reply to a message you want to broadcast."
        );
      }

      const originalMessage = msg.reply_to_message;

      bot.sendMessage(msg.chat.id, "📢 Broadcast started! Sending messages...");

      // Fetch all users from the database
      const users = await UserModel.find();
      let sentCount = 0;
      let failedCount = 0;

      // Forward the message to each user
      for (const user of users) {
        try {
          await bot.forwardMessage(
            user.telegramId,
            msg.chat.id,
            originalMessage.message_id
          );
          sentCount++;
        } catch (err) {
          failedCount++;
        }
      }

      // Summary of the broadcast
      bot.sendMessage(
        msg.chat.id,
        `✅ Broadcast complete!\nSent to: ${sentCount} users\n❌ Failed: ${failedCount} users.`
      );
    });

    // ========== MULTIPLE FORCE SUBSCRIBE COMMAND ==========
    bot.onText(/\/forcesub (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;

      if (userId != Number(OWNER_ID)) {
        return bot.sendMessage(chatId, "❌ Only owner can use this command.");
      }

      const args = match[1].split(" ");
      const action = args[0]?.toLowerCase();
      let value = args.slice(1).join(" ").trim(); // support channel names with spaces if any

      let botData = await BotModel.findOne();
      if (!botData) {
        botData = await BotModel.create({
          autodel: "disable",
          forcesub: "disable",
          forceChannels: [],
        });
      }

      if (action === "enable") {
        botData.forcesub = "enable";
        await botData.save();
        return bot.sendMessage(chatId, "✅ Force Subscribe ENABLED.");
      }

      if (action === "disable") {
        botData.forcesub = "disable";
        await botData.save();
        return bot.sendMessage(chatId, "❌ Force Subscribe DISABLED.");
      }

      if (action === "add") {
        if (!value) return bot.sendMessage(chatId, "Use: /forcesub add @channel");

        // normalize: ensure starts with @
        if (!value.startsWith("@")) value = "@" + value;

        botData.forceChannels.push(value);
        botData.forceChannels = [...new Set(botData.forceChannels)];
        await botData.save();

        return bot.sendMessage(chatId, `➕ Added: ${value}`);
      }

      if (action === "remove") {
        if (!value) return bot.sendMessage(chatId, "Use: /forcesub remove @channel");

        if (!value.startsWith("@")) value = "@" + value;

        botData.forceChannels = botData.forceChannels.filter((ch) => ch !== value);
        await botData.save();

        return bot.sendMessage(chatId, `➖ Removed: ${value}`);
      }

      if (action === "list") {
        if (!botData.forceChannels || botData.forceChannels.length === 0) {
          return bot.sendMessage(chatId, "No forced channels added.");
        }

        return bot.sendMessage(chatId, "📌 Current Forced Channels:\n" + botData.forceChannels.join("\n"));
      }

      return bot.sendMessage(
        chatId,
        "❗ Wrong Format\nUse:\n/forcesub enable\n/forcesub disable\n/forcesub add @channel\n/forcesub remove @channel\n/forcesub list"
      );
    });

    // ========== CALLBACK CHECK FOR "I Joined" BUTTON ==========
    bot.on("callback_query", async (query) => {
      try {
        if (query.data === "check_force") {
          const userId = query.from.id;
          const botData = await BotModel.findOne();
          if (!botData || !botData.forceChannels || botData.forceChannels.length === 0) {
            return bot.answerCallbackQuery(query.id, { text: "No channels configured.", show_alert: true });
          }

          for (const channel of botData.forceChannels) {
            try {
              const channelForApi = channel.startsWith("@") ? channel : `@${channel}`;
              const member = await bot.getChatMember(channelForApi, userId);

              if (member.status === "left" || member.status === "kicked") {
                return bot.answerCallbackQuery(query.id, { text: `❗ Please join ${channel}`, show_alert: true });
              }
            } catch (err) {
              console.log("Callback check error:", err);
              // if channel invalid or error, inform user to check with owner
              return bot.answerCallbackQuery(query.id, { text: `Error checking ${channel}. Contact owner.`, show_alert: true });
            }
          }

          return bot.answerCallbackQuery(query.id, { text: "✔ Verified!" });
        }
      } catch (e) {
        console.log("callback_query handler error:", e);
      }
    });

    // Load remaining commands (unchanged)
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

    // Express server for webhook or other purposes
    app.listen(3000, () => {
      console.log("Bot is Running");
    });

    console.log(`Bot username: @${botUsername}`);

    // You can now use botUsername for generating links or other purposes
  })
  .catch((error) => {
    console.error("Error fetching bot info:", error);
  });
