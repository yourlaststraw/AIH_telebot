const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Define expense categories relevant to Singapore
const EXPENSE_CATEGORIES = [
  'Food 🍲', 'Transport 🚗', 'Housing 🏠', 'Healthcare 🏥', 
  'Others'
];

// CSV writer for feedback
const csvWriter = createCsvWriter({
  path: 'feedback.csv',
  header: [
    { id: 'chatId', title: 'Chat ID' },
    { id: 'feedback', title: 'Feedback' },
    { id: 'timestamp', title: 'Timestamp' }
  ],
  append: true 
});

// In-memory storage
const userGoals = {};
const userExpenses = {}; 
const userStates = {}; // Track user conversation state

// Function to get response from Gemini API with Singapore context
async function getGeminiResponse(message, userId) {
    try {
      const singaporeContext = `You are a helpful financial assistant for people in Singapore. 
      Give advice that's relevant to Singapore's context, mentioning local services, 
      costs, and regulations where appropriate. Focus on practical financial advice 
      for living in Singapore. Make the response short and concise maximum 2 paragraphs `;
      
      const fullPrompt = `${singaporeContext}\n\nUser query: ${message}`;
      
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-002:generateContent?key=${GEMINI_API_KEY}`,
        { contents: [{ parts: [{ text: fullPrompt }] }] },
        { headers: { "Content-Type": "application/json" } }
      );
  
      if (response.data?.candidates?.length > 0 && response.data.candidates[0].content.parts.length > 0) {
        let textResponse = response.data.candidates[0].content.parts[0].text;
  
        // First, remove all existing formatting to start fresh
        textResponse = textResponse
          .replace(/\*\*/g, "")
          .replace(/\*/g, "")
          .replace(/<\/?[^>]+(>|$)/g, "");
        
        // Format using double asterisks for Telegram bold
        let formattedText = textResponse
          // Format section headers - any line ending with a colon
        
          // Format bullet points nicely
          .replace(/^\s*[\•\-\*]\s*(?!\*\*)/gm, "• ")
          
          // Ensure proper paragraph spacing
          .replace(/\n{3,}/g, "\n\n")  // Limit to max double line breaks
          .replace(/(?<!\n)\n(?!\n)/g, "\n\n");  // Convert single breaks to double
        
        // Remove any nested bold markers that might cause formatting issues
        formattedText = formattedText
          
          .replace(/\*\*\s*\*\*/g, " "); // Cleans up extra spaces between bold markers
        
        return formattedText.trim();
      } else {
        return "Sorry, I couldn't fetch an answer at the moment.";
      }
    } catch (error) {
      console.error("Gemini API Error:", error.response?.data || error.message);
      return "There was an error processing your request. Please try again later.";
    }
  }

  

// Send welcome message with inline menu
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  // Reset user state
  userStates[chatId] = {
    awaitingResponse: false,
    currentAction: null
  };
  
  // Send menu image
  await bot.sendPhoto(chatId, './menu_image.jpg', {
    caption: "Welcome to your Singapore Finance Assistant 🇸🇬"
  });
  
  // Send main menu with inline buttons
  bot.sendMessage(
    chatId,
    "I can help you manage your finances in Singapore. What would you like to do?",
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📊 Expense Tracking", callback_data: "expense_tracking" }
          ],
          [
            { text: "💰 Financial Goals", callback_data: "financial_goals" }
          ],
          [
            { text: "ℹ️ General Enquiries", callback_data: "general_enquiries" }],[
            { text: "📩 Feedback & Support", callback_data: "feedback" }
          ]
        ]
      }
    }
  );
});

// Handle callback queries from inline buttons
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  
  // Acknowledge the callback query
  bot.answerCallbackQuery(callbackQuery.id);
  
  // Main menu options
  if (data === 'expense_tracking') {
    bot.sendMessage(chatId, "Expense Tracking Options:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📝 Add New Expense", callback_data: "add_expense" },
            { text: "📊 View Expenses", callback_data: "view_expenses" }
          ],
          [{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]
        ]
      }
    });
  } 
  else if (data === 'financial_goals') {
    bot.sendMessage(chatId, "Financial Goals Options:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎯 Set Financial Goal", callback_data: "set_goal" }],
          [{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]
        ]
      }
    });
  }
  else if (data === 'general_enquiries') {
    userStates[chatId] = {
      awaitingResponse: true,
      currentAction: 'general_enquiries'
    };
    
    bot.sendMessage(chatId, "Hello! How are you doing today? What can I help you with regarding finances in Singapore?", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]
        ]
      }
    });
  }
  else if (data === 'feedback') {
    userStates[chatId] = {
      awaitingResponse: true,
      currentAction: 'feedback'
    };
    
    bot.sendMessage(chatId, "Please share your feedback or questions about the bot. We appreciate your input!", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]
        ]
      }
    });
  }
  // Sub-menu options
  else if (data === 'add_expense') {
    userStates[chatId] = {
      awaitingResponse: true,
      currentAction: 'add_expense'
    };
    
    // Show category selection keyboard
    const categoryKeyboard = [];
    const categoriesPerRow = 2;
    
    for (let i = 0; i < EXPENSE_CATEGORIES.length; i += categoriesPerRow) {
      const row = [];
      for (let j = 0; j < categoriesPerRow; j++) {
        if (i + j < EXPENSE_CATEGORIES.length) {
          row.push({ text: EXPENSE_CATEGORIES[i + j], callback_data: `category_${EXPENSE_CATEGORIES[i + j]}` });
        }
      }
      categoryKeyboard.push(row);
    }
    
    categoryKeyboard.push([{ text: "🔙 Back", callback_data: "expense_tracking" }]);
    
    bot.sendMessage(chatId, "Please select a category for your expense:", {
      reply_markup: {
        inline_keyboard: categoryKeyboard
      }
    });
  }
  else if (data.startsWith('category_')) {
    const category = data.replace('category_', '');
    userStates[chatId] = {
      awaitingResponse: true,
      currentAction: 'add_expense_amount',
      category: category
    };
    
    bot.sendMessage(chatId, `Selected category: ${category}\nPlease enter the expense amount in SGD (e.g., 15.50):`);
  }
  else if (data === 'view_expenses') {
    displayExpenses(chatId);
  }
  else if (data === 'set_goal') {
    userStates[chatId] = {
      awaitingResponse: true,
      currentAction: 'set_goal'
    };
    
    bot.sendMessage(chatId, "Please set your financial goal in this format:\n\n'amount in SGD + target date + purpose'\n\nExample: '500 by December 2025 for emergency fund'");
  }
  else if (data === 'main_menu') {
    // Reset user state
    userStates[chatId] = {
      awaitingResponse: false,
      currentAction: null
    };

    await bot.sendPhoto(chatId, './menu_image.jpg', {
      caption: "Welcome back to your Singapore Finance Assistant 🇸🇬"
    });
    
    bot.sendMessage(
      chatId,
      "Main Menu - What would you like to do?",
      {
        reply_markup: {
          inline_keyboard: [
            [
                { text: "📊 Expense Tracking", callback_data: "expense_tracking" }
              ],
              [
                { text: "💰 Financial Goals", callback_data: "financial_goals" }
              ],
              [
                { text: "ℹ️ General Enquiries", callback_data: "general_enquiries" }],[
                { text: "📩 Feedback & Support", callback_data: "feedback" }
              ]
          ]
        }
      }
    );
  }
});

// Display expenses with category breakdown
async function displayExpenses(chatId) {
  if (!userExpenses[chatId] || userExpenses[chatId].length === 0) {
    bot.sendMessage(chatId, "You haven't tracked any expenses yet.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Back", callback_data: "expense_tracking" }]
        ]
      }
    });
    return;
  }
  
  // Prepare expense summary
  let expenseSummary = "*Your Expenses Summary*\n\n";
  let totalExpenses = 0;
  
  // Calculate category totals
  const categoryTotals = {};
  EXPENSE_CATEGORIES.forEach(cat => categoryTotals[cat] = 0);
  
  userExpenses[chatId].forEach(expense => {
    const amount = parseFloat(expense.amount);
    categoryTotals[expense.category] += amount;
    totalExpenses += amount;
  });
  
  // Add category breakdown
  expenseSummary += "*Category Breakdown:*\n";
  for (const category in categoryTotals) {
    if (categoryTotals[category] > 0) {
      const percentage = ((categoryTotals[category] / totalExpenses) * 100).toFixed(1);
      expenseSummary += `${category}: $${categoryTotals[category].toFixed(2)} (${percentage}%)\n`;
    }
  }
  
  // Add total
  expenseSummary += `\n*Total Expenses: $${totalExpenses.toFixed(2)}*`;
  
  // Find top spending category
  let topCategory = "";
  let topAmount = 0;
  for (const category in categoryTotals) {
    if (categoryTotals[category] > topAmount) {
      topAmount = categoryTotals[category];
      topCategory = category;
    }
  }
  
  if (topCategory) {
    // Get a dynamic financial tip for the top spending category
    const tipMessage = await getGeminiResponse(`Provide a one-line financial tip for someone spending a lot on ${topCategory}`, chatId);
    expenseSummary += `\n\n💡 *Tip:* Your highest spending is in ${topCategory}. ${tipMessage}`;
  }
  
  bot.sendMessage(chatId, expenseSummary, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "See All Expenses", callback_data: "view_all_expenses" },
          { text: "Clear Expenses", callback_data: "clear_expenses" }
        ],
        [{ text: "🔙 Back", callback_data: "expense_tracking" }]
      ]
    }
  });
}

// Handle text messages
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // If we're not expecting any text input, ignore
  if (!userStates[chatId] || !userStates[chatId].awaitingResponse) return;
  
  const currentAction = userStates[chatId].currentAction;
  
  if (currentAction === 'add_expense_amount') {
    const amount = parseFloat(text.replace(/[^0-9.-]+/g, ''));
    
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, "Please enter a valid expense amount (a positive number).");
      return;
    }
    
    // Initialize user expenses if needed
    if (!userExpenses[chatId]) {
      userExpenses[chatId] = [];
    }
    
    // Add the expense with category
    userExpenses[chatId].push({
      amount: amount.toFixed(2),
      category: userStates[chatId].category,
      date: new Date().toISOString().split('T')[0]
    });
    
    bot.sendMessage(chatId, `✅ Expense added: $${amount.toFixed(2)} for ${userStates[chatId].category}`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Add Another Expense", callback_data: "add_expense" },
            { text: "View Expenses", callback_data: "view_expenses" }
          ],
          [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
        ]
      }
    });
    
    // Reset user state
    userStates[chatId].awaitingResponse = false;
  }
  else if (currentAction === 'set_goal') {
    userGoals[chatId] = text;
    
    bot.sendMessage(chatId, `✅ Financial goal set: *${text}*\n\nI'll send you daily reminders to help you stay on track!`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
        ]
      }
    });
    
    // Reset user state
    userStates[chatId].awaitingResponse = false;
  }
  else if (currentAction === 'feedback') {
    // Save feedback to CSV
    const feedback = text;
    const timestamp = new Date().toISOString();
    
    csvWriter.writeRecords([{ chatId, feedback, timestamp }])
      .then(() => {
        bot.sendMessage(chatId, "Thank you for your feedback! We appreciate your input.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
            ]
          }
        });
      })
      .catch((err) => {
        console.error("Error writing feedback to CSV:", err);
        bot.sendMessage(chatId, "There was an issue saving your feedback. Please try again later.");
      });
    
    // Reset user state
    userStates[chatId].awaitingResponse = false;
  }
  else if (currentAction === 'general_enquiries') {
    // Get response from Gemini
    const reply = await getGeminiResponse(text, chatId);
    
    bot.sendMessage(chatId, reply, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Ask Another Question", callback_data: "general_enquiries" }],
          [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
        ]
      }
    });
    
    // Reset user state
    userStates[chatId].awaitingResponse = false;
  }
});


// Schedule daily reminders with personalized tips based on user spending
cron.schedule('19 16 * * *', async () => {
  for (const chatId in userGoals) {
    if (userGoals[chatId] && userExpenses[chatId] && userExpenses[chatId].length > 0) {
      // Calculate highest spending category
      const categoryTotals = {};
      let totalSpent = 0;
      
      userExpenses[chatId].forEach(expense => {
        const category = expense.category;
        const amount = parseFloat(expense.amount);
        
        categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        totalSpent += amount;
      });
      
      let highestCategory = "";
      let highestAmount = 0;
      
      // Find the highest spending category
      for (const category in categoryTotals) {
        if (categoryTotals[category] > highestAmount) {
          highestAmount = categoryTotals[category];
          highestCategory = category;
        }
      }
      
      // Get dynamic tip from Gemini API
      let tipMessage = "";
      try {
        tipMessage = await getGeminiResponse(`Provide a one-liner financial tip for someone spending a lot on ${highestCategory}`);
      } catch (error) {
        console.error('Error fetching tip from Gemini:', error);
        tipMessage = "Consider reviewing your spending habits and adjust your budget accordingly.";
      }

      const message = `⏰ *Daily Financial Reminder*\n\n*Your goal: ${userGoals[chatId]}\n\n💰 You've spent the most on ${highestCategory}.\n\n💡 Tip:* ${tipMessage}`;

      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } else if (userGoals[chatId]) {
      // If we have a goal but no expenses
      bot.sendMessage(chatId, `⏰ *Daily Financial Reminder*\n\nYour goal: ${userGoals[chatId]}\n\n💡 *Tip:* Start tracking your expenses to get personalized saving advice.`, { parse_mode: "Markdown" });
    }
  }
}, {
  timezone: "Asia/Singapore"
});

// Function to get a response from Gemini
async function getGeminiResponse(message) {
  try {
    const singaporeContext = `You are a helpful financial assistant for people in Singapore. 
    Provide practical, actionable financial advice tailored for Singaporeans. 
    Keep the response concise and no more than 1-2 sentences.`;
    
    const fullPrompt = `${singaporeContext}\n\nUser query: ${message}`;
    
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-002:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: fullPrompt }] }] },
      { headers: { "Content-Type": "application/json" } }
    );
    
    if (response.data?.candidates?.length > 0 && response.data.candidates[0].content.parts.length > 0) {
      let textResponse = response.data.candidates[0].content.parts[0].text;
      
      // Clean up the response
      textResponse = textResponse
        .replace(/\*\*/g, "")  // Remove bold formatting
        .replace(/\*/g, "")    // Remove italic
        .replace(/<\/?[^>]+(>|$)/g, "");  // Strip any HTML tags
      
      return textResponse.trim();
    } else {
      return "Sorry, I couldn't fetch an answer at the moment.";
    }
  } catch (error) {
    console.error("Gemini API Error:", error.response?.data || error.message);
    return "There was an error processing your request. Please try again later.";
  }
}

// Listen for additional callback queries
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  
  // Additional handlers for callback queries
  if (data === 'view_all_expenses') {
    if (!userExpenses[chatId] || userExpenses[chatId].length === 0) {
      bot.sendMessage(chatId, "You haven't tracked any expenses yet.");
      return;
    }
    
    let expenseList = "*All Expenses*\n\n";
    userExpenses[chatId].forEach((expense, index) => {
      expenseList += `${index + 1}. $${expense.amount} - ${expense.category} (${expense.date})\n`;
    });
    
    bot.sendMessage(chatId, expenseList, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Back", callback_data: "view_expenses" }]
        ]
      }
    });
  }
  else if (data === 'clear_expenses') {
    if (userExpenses[chatId] && userExpenses[chatId].length > 0) {
      userExpenses[chatId] = [];
      bot.sendMessage(chatId, "✅ Your expenses have been cleared!", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Back to Expense Tracking", callback_data: "expense_tracking" }]
          ]
        }
      });
    } else {
      bot.sendMessage(chatId, "You have no expenses to clear.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Back", callback_data: "expense_tracking" }]
          ]
        }
      });
    }
  }
});

console.log("Bot is running...");