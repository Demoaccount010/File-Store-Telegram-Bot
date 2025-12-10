// Commands/Settings.js
module.exports = async function (app, bot, UserModel, OWNER_ID, BotModel) {

  // ensure botData exists
  let botData = await BotModel.findOne();
  if (!botData) {
    botData = await BotModel.create({ autodel: "disable", forcesub: "disable", forceChannels: [] });
  }

  bot.onText(/\/settings/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId != Number(OWNER_ID)) return;

    // Refresh botData before showing (in case changed)
    botData = await BotModel.findOne();

    bot.sendMessage(chatId, "Your Bot Settings", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: botData.autodel === "disable" ? "Enable Auto Delete" : "Disable Auto Delete",
              callback_data: botData.autodel === "disable" ? "enable_auto_del" : "disable_auto_del",
            },
          ],
          [
            {
              text: botData.forcesub === "disable" ? "Enable Force Sub" : "Disable Force Sub",
              callback_data: botData.forcesub === "disable" ? "enable_force" : "disable_force",
            },
          ],
          [
            {
              text: "Manage Force Channels",
              callback_data: "manage_force_channels",
            },
          ],
        ],
      },
    });
  });

  bot.on("callback_query", async (sq) => {
    try {
      // refresh
      botData = await BotModel.findOne();

      if (sq.data === "enable_auto_del") {
        botData.autodel = "enable";
        await botData.save();
        return bot.answerCallbackQuery(sq.id, { text: "Auto-delete enabled." });
      }

      if (sq.data === "disable_auto_del") {
        botData.autodel = "disable";
        await botData.save();
        return bot.answerCallbackQuery(sq.id, { text: "Auto-delete disabled." });
      }

      if (sq.data === "enable_force") {
        botData.forcesub = "enable";
        await botData.save();
        return bot.answerCallbackQuery(sq.id, { text: "Force Sub enabled." });
      }

      if (sq.data === "disable_force") {
        botData.forcesub = "disable";
        await botData.save();
        return bot.answerCallbackQuery(sq.id, { text: "Force Sub disabled." });
      }

      if (sq.data === "manage_force_channels") {
        // show current channels and instructions
        const channels = (botData.forceChannels && botData.forceChannels.length) ? botData.forceChannels.join("\n") : "No channels configured.";
        const text = `📌 Current forced channels:\n${channels}\n\nUse /forcesub add @channel or /forcesub remove @channel`;
        return bot.sendMessage(sq.from.id, text);
      }
    } catch (err) {
      console.error("Settings callback error:", err);
      return bot.answerCallbackQuery(sq.id, { text: "Update failed." });
    }
  });

};
