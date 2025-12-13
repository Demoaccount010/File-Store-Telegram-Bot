module.exports = async function (app, bot, UserModel, OWNER_ID, BotModel) {
  bot.onText(/\/legal|\/disclaimer/, (msg) => {
    const legalText = `
<b>📜 Copyright & Legal Disclaimer</b>

This bot is provided strictly for <b>educational</b>, <b>testing</b>, and <b>personal file management</b> purposes only.

📌 <b>Important Notice:</b>
All links, media, and content accessed or shared through this bot are sourced from <b>third-party platforms</b>.  
This bot <b>does not host</b>, store permanently, or claim ownership over any copyrighted material.

⚖️ <b>Fair Use Statement:</b>
Any reference, access, or redirection to third-party content is done under the principles of <b>Fair Use</b> (for education, research, review, or informational purposes).

🚫 <b>Prohibited Activities:</b>
- Uploading or distributing copyrighted content without permission  
- Using the bot for piracy, redistribution, or commercial exploitation  
- Any illegal or abusive usage

🛡️ <b>Liability Disclaimer:</b>
Users are solely responsible for the content they upload, share, or access.  
The developer holds <b>no responsibility or liability</b> for any misuse or copyright violations caused by users.

<b>👨‍💻 Developer: @yoursmileyt</b>  
<b>🔗 Channel: https://t.me/Hindi_Animes_Series</b>
<b>🤖 Bot: @yoursmile_sharerobot</b>

By using this bot, you agree to comply with all applicable laws and use it responsibly. ✨
`;

    bot.sendMessage(msg.chat.id, legalText, { parse_mode: "HTML" });
  });
};
