module.exports = async function (app, bot, UserModel, OWNER_ID, BotModel) {
  let botData = await BotModel.findOne();
  if (!botData) {
    botData = await BotModel.create({
      autodel: "disable",
      forcesub: "disable",
      forceChannels: [],
    });
  }

  bot.onText(/\/settings/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId != Number(OWNER_ID)) return;

    botData = await BotModel.findOne();

    bot.sendMessage(chatId, "⚙️ Bot Settings", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                botData.autodel === "disable"
                  ? "Enable Auto Delete"
                  : "Disable Auto Delete",
              callback_data:
                botData.autodel === "disable"
                  ? "enable_auto_del"
                  : "disable_auto_del",
            },
          ],
          [
            {
              text:
                botData.forcesub === "disable"
                  ? "Enable ForceSub"
                  : "Disable ForceSub",
              callback_data:
                botData.forcesub === "disable"
                  ? "enable_force"
                  : "disable_force",
            },
          ],
          [
            {
              text: "Manage Channels",
              callback_data: "manage_channels",
            },
          ],
        ],
      },
    });
  });

  bot.on("callback_query", async (q) => {
    botData = await BotModel.findOne();

    if (q.data === "enable_auto_del") {
      botData.autodel = "enable";
      await botData.save();
      return bot.answerCallbackQuery(q.id, { text: "Auto Delete Enabled" });
    }

    if (q.data === "disable_auto_del") {
      botData.autodel = "disable";
      await botData.save();
      return bot.answerCallbackQuery(q.id, { text: "Auto Delete Disabled" });
    }

    if (q.data === "enable_force") {
      botData.forcesub = "enable";
      await botData.save();
      return bot.answerCallbackQuery(q.id, { text: "ForceSub Enabled" });
    }

    if (q.data === "disable_force") {
      botData.forcesub = "disable";
      await botData.save();
      return bot.answerCallbackQuery(q.id, { text: "ForceSub Disabled" });
    }

    if (q.data === "manage_channels") {
      const list =
        botData.forceChannels.length === 0
          ? "No channels added."
          : botData.forceChannels.join("\n");

      return bot.sendMessage(
        q.from.id,
        `📌 Current Channels:\n${list}\n\nUse commands:\n /forcesub add @channel\n /forcesub remove @channel\n /forcesub list`
      );
    }
  });
};
