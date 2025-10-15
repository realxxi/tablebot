const TelegramBot = require("node-telegram-bot-api")
const axios = require("axios")
const cheerio = require("cheerio")
const fs = require("fs")
const cron = require("node-cron")

// Bot ma'lumotlari
const TOKEN = "7961346657:AAGe8gO0wQNGrOEDjh4xSJIbwT11e0p_ppc"

const bot = new TelegramBot(TOKEN, { polling: true })

// Axios client
const client = axios.create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "uz-UZ,uz;q=0.9,ru;q=0.8,en;q=0.7",
  },
  timeout: 20000,
  validateStatus: () => true,
})

const DATA_FILE = "data.json"

function loadUsers() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, "utf8")
      return JSON.parse(data)
    }
  } catch (error) {
    console.error("Foydalanuvchilarni yuklash xatosi:", error.message)
  }
  return {}
}

function saveUser(chatId, login, password) {
  try {
    const users = loadUsers()
    users[chatId] = { login, password }
    fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2))
    console.log(`✅ Foydalanuvchi saqlandi: ${chatId}`)
    return true
  } catch (error) {
    console.error("Foydalanuvchini saqlash xatosi:", error.message)
    return false
  }
}

function getUser(chatId) {
  const users = loadUsers()
  return users[chatId] || null
}

function deleteUser(chatId) {
  try {
    const users = loadUsers()
    delete users[chatId]
    fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2))
    console.log(`🗑️ Foydalanuvchi o'chirildi: ${chatId}`)
    return true
  } catch (error) {
    console.error("Foydalanuvchini o'chirish xatosi:", error.message)
    return false
  }
}

// Foydalanuvchi holatini saqlash (login/parol kiritish jarayoni uchun)
const userStates = {}

class TSTUParser {
  constructor() {
    this.baseUrl = "https://student.tstu.uz"
    this.cookies = {}
  }

  extractCookies(setCookieHeaders) {
    if (!setCookieHeaders) return

    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]
    headers.forEach((cookie) => {
      const parts = cookie.split(";")[0].split("=")
      if (parts.length === 2) {
        this.cookies[parts[0]] = parts[1]
      }
    })
  }

  getCookieString() {
    return Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join("; ")
  }

  async verifyLogin() {
    try {
      const dashboardUrl = `${this.baseUrl}/dashboard`
      const response = await client.get(dashboardUrl, {
        headers: {
          Cookie: this.getCookieString(),
        },
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      })

      if (response.status === 302 && response.headers.location && response.headers.location.includes("login")) {
        return false
      }

      const $ = cheerio.load(response.data)

      const hasLogout = $('a[href*="logout"]').length > 0
      const hasUserInfo = $(".user-name, .user-menu").length > 0
      const hasDashboard = $(".content-wrapper").length > 0

      console.log("Verify login:")
      console.log("- Status:", response.status)
      console.log("- Logout:", hasLogout)
      console.log("- User info:", hasUserInfo)
      console.log("- Dashboard:", hasDashboard)

      return hasLogout || hasUserInfo || hasDashboard
    } catch (error) {
      console.error("Verify login xato:", error.message)
      return false
    }
  }

  async login(username, password) {
    try {
      console.log("\n=== LOGIN BOSHLANDI ===")

      const loginPageUrl = `${this.baseUrl}/dashboard/login`
      const pageResponse = await client.get(loginPageUrl)

      console.log("1. Login sahifa status:", pageResponse.status)
      this.extractCookies(pageResponse.headers["set-cookie"])
      console.log("Cookies:", Object.keys(this.cookies))

      const $ = cheerio.load(pageResponse.data)

      const form = $("form").first()
      const formAction = form.attr("action") || loginPageUrl
      const formData = {}

      form.find('input[type="hidden"]').each((i, elem) => {
        const name = $(elem).attr("name")
        const value = $(elem).attr("value") || ""
        if (name) formData[name] = value
      })

      form.find('input[type="checkbox"][checked], input[type="radio"][checked]').each((i, elem) => {
        const name = $(elem).attr("name")
        const value = $(elem).attr("value") || "1"
        if (name) formData[name] = value
      })

      const loginField = form.find('input[type="text"], input[name*="login"], input[name*="username"]').first()
      const passwordField = form.find('input[type="password"]').first()

      if (loginField.length > 0) {
        formData[loginField.attr("name")] = username
        console.log("Login field:", loginField.attr("name"))
      } else {
        console.log("⚠️ Login field topilmadi!")
      }

      if (passwordField.length > 0) {
        formData[passwordField.attr("name")] = password
        console.log("Password field:", passwordField.attr("name"))
      } else {
        console.log("⚠️ Password field topilmadi!")
      }

      const postUrl = formAction.startsWith("http")
        ? formAction
        : formAction.startsWith("/")
          ? `${this.baseUrl}${formAction}`
          : `${loginPageUrl}/${formAction}`

      console.log("\n2. Login so'rovi:")
      console.log("POST URL:", postUrl)
      console.log("Form fields:", Object.keys(formData))

      const loginResponse = await client({
        method: "post",
        url: postUrl,
        data: new URLSearchParams(formData).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: this.getCookieString(),
          Referer: loginPageUrl,
          Origin: this.baseUrl,
        },
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      })

      console.log("Response status:", loginResponse.status)
      this.extractCookies(loginResponse.headers["set-cookie"])
      console.log("Yangi cookies:", Object.keys(this.cookies))

      if (loginResponse.status === 302 || loginResponse.status === 301) {
        const redirectUrl = loginResponse.headers.location
        console.log("Redirect:", redirectUrl)

        if (!redirectUrl.includes("login")) {
          console.log("✅ LOGIN MUVAFFAQIYATLI (redirect)")
          return { success: true }
        }
      }

      const $response = cheerio.load(loginResponse.data)

      const errors = []
      $response(".error, .alert-danger, .has-error .help-block, .invalid-feedback").each((i, elem) => {
        const text = $response(elem).text().trim()
        if (text && text.length > 0) errors.push(text)
      })

      if (errors.length > 0) {
        console.log("❌ Login xato:", errors)
        return { success: false, message: errors.join(", ") }
      }

      const hasLogout = $response('a[href*="logout"], a[href*="chiqish"]').length > 0
      const hasUserMenu = $response(".user-menu, .dropdown.user").length > 0
      const hasDashboard = $response(".content-wrapper").length > 0
      const hasStudentInfo = $response(".user-name, .student-name").length > 0

      console.log("\n3. Natija tekshiruv:")
      console.log("- Logout tugma:", hasLogout)
      console.log("- User menu:", hasUserMenu)
      console.log("- Dashboard:", hasDashboard)
      console.log("- Student info:", hasStudentInfo)

      if (hasLogout || hasUserMenu || hasDashboard || hasStudentInfo) {
        console.log("✅ LOGIN MUVAFFAQIYATLI!")
        return { success: true }
      }

      console.log("\n4. Dashboard orqali tekshirish...")
      const isLoggedIn = await this.verifyLogin()

      if (isLoggedIn) {
        console.log("✅ LOGIN MUVAFFAQIYATLI (dashboard orqali tasdiqlandi)")
        return { success: true }
      }

      return { success: false, message: "Login yoki parol noto'g'ri, yoki tizim xatosi" }
    } catch (error) {
      console.error("\n❌ XATOLIK:", error.message)
      if (error.response) {
        console.error("Response status:", error.response.status)
      }
      return { success: false, message: error.message }
    }
  }

  parseDateFromText(dateText) {
    if (!dateText) return null

    const monthNames = {
      yanvar: 0,
      fevral: 1,
      mart: 2,
      aprel: 3,
      may: 4,
      iyun: 5,
      iyul: 6,
      avgust: 7,
      sentabr: 8,
      oktabr: 9,
      noyabr: 10,
      dekabr: 11,
    }

    const match1 = dateText.match(/(\d{1,2})\s+(\w+),?\s*(\d{4})/)
    if (match1) {
      const [_, day, monthName, year] = match1
      const month = monthNames[monthName.toLowerCase()]
      if (month !== undefined) {
        return new Date(year, month, Number.parseInt(day))
      }
    }

    const match2 = dateText.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
    if (match2) {
      const [_, day, month, year] = match2
      return new Date(year, month - 1, Number.parseInt(day))
    }

    return null
  }

  isSameDate(date1, date2) {
    return (
      date1.getDate() === date2.getDate() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getFullYear() === date2.getFullYear()
    )
  }

  async findWeekIdForToday() {
    try {
      const today = new Date()
      console.log(`📅 Bugungi sana: ${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`)

      let weekId = getStartWeekId()
      const maxAttempts = 20

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        console.log(`\n🔍 Hafta ${weekId} tekshirilmoqda...`)

        const url = `${this.baseUrl}/education/time-table?week=${weekId}`
        const response = await client.get(url, {
          headers: {
            Cookie: this.getCookieString(),
            Referer: `${this.baseUrl}/dashboard`,
          },
        })

        if (response.status !== 200) {
          weekId++
          continue
        }

        const $ = cheerio.load(response.data)

        const boxes = $(".box.box-success.sh")

        for (let i = 0; i < boxes.length; i++) {
          const $box = $(boxes[i])
          const dateText = $box.find(".box-title span.pull-right").text().trim()
          const scheduleDate = this.parseDateFromText(dateText)

          if (scheduleDate && this.isSameDate(scheduleDate, today)) {
            console.log(`✅ Bugungi sana topildi! Hafta: ${weekId}, Sana: ${dateText}`)
            saveWeekCache(weekId)
            return weekId
          }
        }

        weekId++
      }

      console.log("⚠️ Bugungi sana hech qaysi haftada topilmadi, default haftani ishlatamiz")
      return null
    } catch (error) {
      console.error("Hafta topish xatosi:", error.message)
      return null
    }
  }

  async getCurrentWeekId() {
    try {
      const weekIdForToday = await this.findWeekIdForToday()
      if (weekIdForToday) {
        return weekIdForToday
      }

      const url = `${this.baseUrl}/education/time-table`
      const response = await client.get(url, {
        headers: {
          Cookie: this.getCookieString(),
          Referer: `${this.baseUrl}/dashboard`,
        },
      })

      if (response.status !== 200) return null

      const $ = cheerio.load(response.data)
      const selectElement = $('select[name="week"]')
      const selectedOption = selectElement.find("option[selected]")

      if (selectedOption.length > 0) {
        return selectedOption.attr("value")
      }

      return null
    } catch (error) {
      console.error("Hafta ID olish xatosi:", error.message)
      return null
    }
  }

  async getSchedule(weekId = null) {
    try {
      if (!weekId) {
        weekId = await this.getCurrentWeekId()
      }

      const url = weekId
        ? `${this.baseUrl}/education/time-table?week=${weekId}`
        : `${this.baseUrl}/education/time-table`

      console.log("\n📅 Jadval olish:", url)

      const response = await client.get(url, {
        headers: {
          Cookie: this.getCookieString(),
          Referer: `${this.baseUrl}/dashboard`,
        },
      })

      console.log("Status:", response.status)

      if (response.status !== 200) {
        console.log("Xato: Status", response.status)
        return null
      }

      const $ = cheerio.load(response.data)
      const schedule = {}

      $(".box.box-success.sh").each((i, box) => {
        const $box = $(box)

        const dayName = $box
          .find(".box-title")
          .first()
          .contents()
          .filter(function () {
            return this.type === "text"
          })
          .text()
          .trim()

        const dateText = $box.find(".box-title .text-muted").text().trim()

        if (!dayName) return

        const lessons = []

        $box.find(".list-group-item").each((j, item) => {
          const $item = $(item)

          const time = $item.find(".pull-right.text-muted").text().trim()

          const lessonText = $item.clone().children().remove().end().text().trim()
          const lessonName = lessonText
            .split("\n")[0]
            .replace(/^\d+\.\s*/, "")
            .trim()

          const details = []
          $item.find(".text-center.text-muted").each((k, span) => {
            const text = $(span).text().trim()
            if (text && text !== "/") {
              details.push(text)
            }
          })

          const room = details[0] || ""
          const type = details[1] || ""
          const teacher = details[2] || ""

          if (lessonName && time) {
            lessons.push({
              time,
              name: lessonName,
              room,
              type,
              teacher,
            })
          }
        })

        if (lessons.length > 0) {
          schedule[dayName] = {
            date: dateText,
            lessons,
          }
        }
      })

      console.log("Topilgan kunlar:", Object.keys(schedule).length)
      return schedule
    } catch (error) {
      console.error("Jadval xatosi:", error.message)
      return null
    }
  }

  formatSchedule(schedule) {
    if (!schedule || Object.keys(schedule).length === 0) {
      return null
    }

    const messages = []
    let currentMessage = "📅 DARS JADVALI\n\n"

    for (const [day, data] of Object.entries(schedule)) {
      let dayText = `📌 ${day.toUpperCase()}`
      if (data.date) {
        dayText += ` (${data.date})`
      }
      dayText += "\n\n"

      for (const lesson of data.lessons) {
        dayText += `⏰ ${lesson.time}\n`
        dayText += `📚 ${lesson.name}\n`
        if (lesson.room) dayText += `🚪 ${lesson.room}`
        if (lesson.type) dayText += ` / ${lesson.type}`
        if (lesson.teacher) dayText += `\n👨‍🏫 ${lesson.teacher}`
        dayText += "\n\n"
      }

      if (currentMessage.length + dayText.length > 3500) {
        messages.push(currentMessage.trim())
        currentMessage = dayText
      } else {
        currentMessage += dayText
      }
    }

    if (currentMessage.trim()) {
      messages.push(currentMessage.trim())
    }

    return messages
  }

  formatTodayTomorrow(schedule) {
    if (!schedule || Object.keys(schedule).length === 0) {
      return null
    }

    const dayNames = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"]
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const todayName = dayNames[today.getDay()]
    const tomorrowName = dayNames[tomorrow.getDay()]

    const messages = []
    let currentMessage = "📅 DARS JADVALI\n\n"

    const daysToShow = [
      { name: todayName, label: "BUGUN", icon: "📅" },
      { name: tomorrowName, label: "ERTAGA", icon: "📆" },
    ]

    for (const { name, label, icon } of daysToShow) {
      const data = schedule[name]

      let dayText = `${icon} ${label} - ${name.toUpperCase()}`
      if (data?.date) {
        dayText += ` (${data.date})`
      }
      dayText += "\n\n"

      if (data && data.lessons.length > 0) {
        for (const lesson of data.lessons) {
          dayText += `⏰ ${lesson.time}\n`
          dayText += `📚 ${lesson.name}\n`
          if (lesson.room) dayText += `🚪 ${lesson.room}`
          if (lesson.type) dayText += ` / ${lesson.type}`
          if (lesson.teacher) dayText += `\n👨‍🏫 ${lesson.teacher}`
          dayText += "\n\n"
        }
      } else {
        dayText += "📭 Darslar yo'q\n\n"
      }

      dayText += "─────────────────\n\n"

      if (currentMessage.length + dayText.length > 3500) {
        messages.push(currentMessage.trim())
        currentMessage = dayText
      } else {
        currentMessage += dayText
      }
    }

    if (currentMessage.trim()) {
      messages.push(currentMessage.trim())
    }

    return messages
  }
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id
  const user = getUser(chatId)

  if (user) {
    bot.sendMessage(
      chatId,
      "✅ Siz allaqachon ro'yxatdan o'tgansiz!\n\n" +
        "🔄 Dars jadvalini olish uchun /jadval buyrug'ini yuboring.\n" +
        "⏰ Har kuni ertalab 8:00 da avtomatik ravishda jadval yuboriladi!\n\n" +
        "🔄 Ma'lumotlarni o'zgartirish uchun /reset buyrug'ini yuboring.\n" +
        "📖 Yordam uchun /help ni bosing.",
    )
  } else {
    bot.sendMessage(
      chatId,
      "👋 Xush kelibsiz! TSTU Dars Jadvali Botiga!\n\n" +
        "🔐 Botdan foydalanish uchun student.tstu.uz hisobingizga kirish ma'lumotlarini kiriting.\n\n" +
        "📝 Iltimos, login (talaba raqamingiz) ni yuboring:",
    )
    userStates[chatId] = { step: "waiting_login" }
  }
})

bot.onText(/\/reset/, (msg) => {
  const chatId = msg.chat.id
  deleteUser(chatId)
  delete userStates[chatId]

  bot.sendMessage(chatId, "🔄 Ma'lumotlaringiz o'chirildi.\n\n" + "📝 Iltimos, login (talaba raqamingiz) ni yuboring:")
  userStates[chatId] = { step: "waiting_login" }
})

bot.onText(/\/jadval/, async (msg) => {
  const chatId = msg.chat.id
  const user = getUser(chatId)

  if (!user) {
    bot.sendMessage(
      chatId,
      "❌ Siz hali ro'yxatdan o'tmagansiz!\n\n" + "📝 Ro'yxatdan o'tish uchun /start buyrug'ini yuboring.",
    )
    return
  }

  try {
    const loadingMsg = await bot.sendMessage(chatId, "⏳ Jadval yuklanmoqda...")

    const parser = new TSTUParser()

    const loginResult = await parser.login(user.login, user.password)

    if (!loginResult.success) {
      await bot.deleteMessage(chatId, loadingMsg.message_id)
      await bot.sendMessage(
        chatId,
        `❌ Tizimga kirish xatosi!\n\nSabab: ${loginResult.message}\n\n` +
          "🔄 Ma'lumotlarni o'zgartirish uchun /reset buyrug'ini yuboring.",
      )
      return
    }

    const schedule = await parser.getSchedule()

    await bot.deleteMessage(chatId, loadingMsg.message_id)

    if (!schedule) {
      await bot.sendMessage(chatId, "❌ Jadval topilmadi yoki xatolik yuz berdi.")
      return
    }

    const messages = parser.formatTodayTomorrow(schedule)

    if (!messages || messages.length === 0) {
      await bot.sendMessage(chatId, "📅 Bugun va ertaga uchun darslar topilmadi.")
      return
    }

    for (const message of messages) {
      await bot.sendMessage(chatId, message)
    }

    await bot.sendMessage(chatId, "✅ Jadval muvaffaqiyatli yuklandi!")
  } catch (error) {
    console.error("Xatolik:", error)
    await bot.sendMessage(chatId, `❌ Xatolik: ${error.message}`)
  }
})

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id
  bot.sendMessage(
    chatId,
    "📖 YORDAM\n\n" +
      "/start - Botni ishga tushirish va ro'yxatdan o'tish\n" +
      "/jadval - Dars jadvalini olish\n" +
      "/reset - Login va parolni o'zgartirish\n" +
      "/help - Yordam\n\n" +
      "⚡️ Bot student.tstu.uz bilan ishlaydi.\n" +
      "⏰ Har kuni ertalab 8:00 da avtomatik jadval yuboriladi.",
  )
})

bot.on("message", async (msg) => {
  const chatId = msg.chat.id
  const text = msg.text

  // Komandalarni o'tkazib yuborish
  if (text && text.startsWith("/")) {
    return
  }

  const state = userStates[chatId]
  if (!state) return

  if (state.step === "waiting_login") {
    userStates[chatId] = { step: "waiting_password", login: text }
    await bot.sendMessage(chatId, "🔐 Endi parolingizni yuboring:")
  } else if (state.step === "waiting_password") {
    const login = state.login
    const password = text

    const verifyMsg = await bot.sendMessage(chatId, "⏳ Ma'lumotlar tekshirilmoqda...")

    // Login va parolni tekshirish
    const parser = new TSTUParser()
    const loginResult = await parser.login(login, password)

    await bot.deleteMessage(chatId, verifyMsg.message_id)

    if (loginResult.success) {
      saveUser(chatId, login, password)
      delete userStates[chatId]

      await bot.sendMessage(
        chatId,
        "✅ Muvaffaqiyatli ro'yxatdan o'tdingiz!\n\n" +
          "🔄 Dars jadvalini olish uchun /jadval buyrug'ini yuboring.\n" +
          "⏰ Har kuni ertalab 8:00 da avtomatik ravishda jadval yuboriladi!",
      )
    } else {
      delete userStates[chatId]
      await bot.sendMessage(
        chatId,
        `❌ Login yoki parol noto'g'ri!\n\nSabab: ${loginResult.message}\n\n` +
          "🔄 Qaytadan urinish uchun /start buyrug'ini yuboring.",
      )
    }
  }
})

// Hafta keshi funksiyalari
const WEEK_CACHE_FILE = "week_cache.json"

function loadWeekCache() {
  try {
    if (fs.existsSync(WEEK_CACHE_FILE)) {
      const data = fs.readFileSync(WEEK_CACHE_FILE, "utf8")
      return JSON.parse(data)
    }
  } catch (error) {
    console.error("Hafta keshini yuklash xatosi:", error.message)
  }
  return { weekId: null, date: null }
}

function saveWeekCache(weekId) {
  try {
    const today = new Date()
    const cache = {
      weekId: weekId,
      date: today.toISOString().split("T")[0],
    }
    fs.writeFileSync(WEEK_CACHE_FILE, JSON.stringify(cache, null, 2))
    console.log(`💾 Hafta saqlandi: ${weekId} (${cache.date})`)
  } catch (error) {
    console.error("Hafta keshini saqlash xatosi:", error.message)
  }
}

function getStartWeekId() {
  const cache = loadWeekCache()
  const today = new Date().toISOString().split("T")[0]

  if (cache.weekId && cache.date === today) {
    console.log(`📋 Keshdan olingan hafta: ${cache.weekId}`)
    return Number.parseInt(cache.weekId)
  }

  if (cache.weekId) {
    console.log(`📋 Oxirgi hafta: ${cache.weekId}, bugundan qidiramiz`)
    return Number.parseInt(cache.weekId)
  }

  return 199161
}

async function sendScheduleToChat(chatId) {
  try {
    const user = getUser(chatId)
    if (!user) {
      console.log(`⚠️ Chat ${chatId} uchun foydalanuvchi topilmadi`)
      return
    }

    const parser = new TSTUParser()
    const loginResult = await parser.login(user.login, user.password)

    if (!loginResult.success) {
      await bot.sendMessage(
        chatId,
        `❌ Tizimga kirish xatosi: ${loginResult.message}\n\n🔄 /reset buyrug'i bilan ma'lumotlarni yangilang.`,
      )
      return
    }

    const schedule = await parser.getSchedule()

    if (!schedule) {
      await bot.sendMessage(chatId, "❌ Jadval topilmadi.")
      return
    }

    const messages = parser.formatTodayTomorrow(schedule)

    if (!messages || messages.length === 0) {
      await bot.sendMessage(chatId, "📅 Bugun va ertaga uchun darslar topilmadi.")
      return
    }

    await bot.sendMessage(chatId, "🌅 Xayrli tong! Bugungi dars jadvali:")

    for (const message of messages) {
      await bot.sendMessage(chatId, message)
    }
  } catch (error) {
    console.error(`Chat ${chatId} ga habar yuborishda xato:`, error.message)
  }
}

async function sendScheduleToAll() {
  console.log("⏰ Har kungi xabar yuborish boshlandi...")
  const users = loadUsers()
  const chatIds = Object.keys(users)

  for (const chatId of chatIds) {
    await sendScheduleToChat(chatId)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  console.log("✅ Barcha foydalanuvchilarga xabar yuborildi!")
}

// Toshkent vaqtini olish funksiyasi
function getTashkentTime() {
  const now = new Date()
  // UTC+5 (Toshkent vaqti)
  const tashkentTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tashkent" }))
  return tashkentTime
}

// Har daqiqada tekshirish va 8:00 da xabar yuborish
cron.schedule("* * * * *", () => {
  const tashkentTime = getTashkentTime()
  const hours = tashkentTime.getHours()
  const minutes = tashkentTime.getMinutes()

  // Toshkent vaqti bo'yicha 8:00 bo'lsa
  if (hours === 8 && minutes === 0) {
    console.log(`⏰ 8:00 (Toshkent vaqti) - Avtomatik xabar yuborish boshlandi`)
    console.log(`   Server vaqti: ${new Date().toLocaleString()}`)
    console.log(`   Toshkent vaqti: ${tashkentTime.toLocaleString()}`)
    sendScheduleToAll()
  }
})

console.log("✅ TSTU Bot ishga tushdi!")
console.log("🤖 Bot tayyor!")
console.log(`⏰ Server vaqti: ${new Date().toLocaleString()}`)
console.log(`⏰ Toshkent vaqti: ${getTashkentTime().toLocaleString()}`)
console.log("⏰ Avtomatik xabar: Har kuni 8:00 (Toshkent vaqti)")
console.log("👥 Har bir foydalanuvchi o'z login va parolini kiritadi")
