require("dotenv").config();

// Add immediate environment check
const REQUIRED_KEYS = ["GEMINI_API_KEY", "TMDB_API_KEY"];
console.log("\nEnvironment Check:");
for (const key of REQUIRED_KEYS) {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ Missing ${key}`);
  } else {
    console.log(`✅ ${key} found: ${value.slice(0, 4)}...${value.slice(-4)}`);
  }
}

const { addonBuilder } = require("stremio-addon-sdk");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require("node-fetch").default;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY not found in environment variables");
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const TMDB_API_BASE = "https://api.themoviedb.org/3";
const CACHE_DURATION = 30 * 60 * 1000;
const tmdbCache = new Map();
const aiRecommendationsCache = new Map();
const AI_CACHE_DURATION = 60 * 60 * 1000;
const JSON5 = require("json5");
const stripComments = require("strip-json-comments").default;

// Alternative way to load environment variables
const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, ".env");
    console.log("Looking for .env file at:", envPath);

    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf8");
      const envVars = envContent
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("#"))
        .reduce((acc, line) => {
          const [key, value] = line.split("=").map((s) => s.trim());
          if (key && value) {
            process.env[key] = value;
            acc[key] = value;
          }
          return acc;
        }, {});

      console.log(
        "Loaded environment variables:",
        Object.keys(envVars).map(
          (key) =>
            `${key}: ${envVars[key].slice(0, 4)}...${envVars[key].slice(-4)}`
        )
      );

      return envVars;
    } else {
      console.error(".env file not found at:", envPath);
      return null;
    }
  } catch (error) {
    console.error("Error loading .env file:", error);
    return null;
  }
}

// Load environment variables
const envVars = loadEnvFile();
if (!envVars?.GEMINI_API_KEY) {
  throw new Error("Failed to load GEMINI_API_KEY from .env file");
}

// Add this performance logging utility near the top with other utility functions
function measureTime(startTime, label) {
  const duration = Date.now() - startTime;
  logWithTime(`⏱️ ${label}: ${duration}ms`);
  return duration;
}

async function searchTMDB(title, type, year) {
  const startTime = Date.now();
  const cacheKey = `${title}-${type}-${year}`;

  const cached = tmdbCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    measureTime(startTime, `TMDB cache hit for: ${title}`);
    return cached.data;
  }

  try {
    const searchType = type === "movie" ? "movie" : "tv";
    const searchParams = new URLSearchParams({
      api_key: TMDB_API_KEY,
      query: title,
      year: year,
      include_adult: false,
      language: "en-US",
    });

    const searchUrl = `${TMDB_API_BASE}/search/${searchType}?${searchParams.toString()}`;
    const searchResponse = await fetch(searchUrl).then((r) => r.json());

    if (searchResponse?.results?.[0]) {
      const result = searchResponse.results[0];

      const tmdbData = {
        poster: result.poster_path
          ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
          : null,
        backdrop: result.backdrop_path
          ? `https://image.tmdb.org/t/p/original${result.backdrop_path}`
          : null,
        tmdbRating: result.vote_average,
        genres: result.genre_ids,
        overview: result.overview || "",
        tmdb_id: result.id,
        title: result.title || result.name,
        release_date: result.release_date || result.first_air_date,
      };

      if (!tmdbData.imdb_id) {
        const detailsUrl = `${TMDB_API_BASE}/${searchType}/${result.id}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
        const details = await fetch(detailsUrl).then((r) => r.json());
        if (details?.external_ids?.imdb_id) {
          tmdbData.imdb_id = details.external_ids.imdb_id;
        }
      }

      tmdbCache.set(cacheKey, {
        timestamp: Date.now(),
        data: tmdbData,
      });

      measureTime(startTime, `TMDB API call for: ${title}`);
      return tmdbData;
    }

    tmdbCache.set(cacheKey, {
      timestamp: Date.now(),
      data: null,
    });

    measureTime(startTime, `TMDB no results for: ${title}`);
    return null;
  } catch (error) {
    logError("TMDB Search Error:", error);
    return null;
  }
}

const manifest = {
  id: "au.itcon.aisearch",
  version: "1.0.0",
  name: "AI Search",
  description: "AI-powered movie and series recommendations",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  catalogs: [
    // {
    //   type: "movie",
    //   id: "search", // For desktop/mobile
    //   name: "AI Movie Search",
    //   extra: [{ name: "search", isRequired: true }],
    //   isSearch: true,
    // },
    {
      type: "movie",
      id: "top", // For Android TV
      name: "AI Movie Search",
      extra: [{ name: "search", isRequired: true }],
      isSearch: true,
    },
    // {
    //   type: "series",
    //   id: "search", // For desktop/mobile
    //   name: "AI Series Search",
    //   extra: [{ name: "search", isRequired: true }],
    //   isSearch: true,
    // },
    {
      type: "series",
      id: "top", // For Android TV
      name: "AI Series Search",
      extra: [{ name: "search", isRequired: true }],
      isSearch: true,
    },
  ],
  behaviorHints: {
    configurable: false,
    searchable: true,
  },
  logo: "https://stremio.itcon.au/aisearch/logo.png",
  background: "https://stremio.itcon.au/aisearch/bg.png",
  contactEmail: "hi@itcon.au",
};

//logWithTime('Initializing addon with manifest:', manifest);

const builder = new addonBuilder(manifest);

function logWithTime(message, data = "") {
  const timestamp = new Date().toISOString();
  const logPrefix = `[${timestamp}] 🔵`;

  if (data) {
    if (typeof data === "object") {
      console.log(`${logPrefix} ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.log(`${logPrefix} ${message}`, data);
    }
  } else {
    console.log(`${logPrefix} ${message}`);
  }
}

function logError(message, error = "") {
  const timestamp = new Date().toISOString();
  console.error(`\n[${timestamp}] 🔴 ${message}`, error);
  if (error && error.stack) {
    console.error(`Stack trace:`, error.stack);
  }
}

function determineIntentFromKeywords(query) {
  const q = query.toLowerCase();

  const movieKeywords = [
    "movie",
    "movies",
    "film",
    "films",
    "cinema",
    "theatrical",
    "feature",
    "features",
    "motion picture",
    "blockbuster",
    "documentary",
    "documentaries",
  ];

  const seriesKeywords = [
    "series",
    "show",
    "shows",
    "tv",
    "television",
    "episode",
    "episodes",
    "sitcom",
    "drama series",
    "miniseries",
    "season",
    "seasons",
    "anime",
    "documentary series",
    "docuseries",
    "web series",
  ];

  const movieMatch = movieKeywords.some((keyword) => q.includes(keyword));
  const seriesMatch = seriesKeywords.some((keyword) => q.includes(keyword));

  if (movieMatch && !seriesMatch) return "movie";
  if (seriesMatch && !movieMatch) return "series";
  return "ambiguous";
}

function sanitizeCSVString(str) {
  try {
    //logWithTime('Raw AI response before sanitization:', str);

    let cleaned = str.replace(/```csv\s*|\s*```/g, "").trim();

    const lines = cleaned
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const recommendations = {
      movies: [],
      series: [],
    };

    for (let i = 1; i < lines.length; i++) {
      const [type, name, year, description, relevance] = lines[i]
        .split("|")
        .map((s) => s.trim());

      if (type && name && year) {
        const item = {
          name,
          year: parseInt(year),
          type,
          description,
          relevance,
          id: `ai_${type}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        };

        if (type === "movie") {
          recommendations.movies.push(item);
        } else if (type === "series") {
          recommendations.series.push(item);
        }
      }
    }

    return JSON.stringify({ recommendations });
  } catch (error) {
    logError("CSV parsing failed:", error);
    throw error;
  }
}

async function getAIRecommendations(query, type) {
  const cacheKey = `${query}_${type}`;

  const cached = aiRecommendationsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < AI_CACHE_DURATION) {
    //logWithTime(`Using cached AI recommendations for: ${query} (${type})`);
    return cached.data;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const promptText = [
      `You are a ${type} recommendation expert. Generate 10 highly relevant ${type} recommendations for "${query}".`,
      "",
      "FORMAT:",
      "type|name|year|description|relevance",
      "",
      "RULES:",
      "1. Use | separator",
      "2. Year: YYYY format",
      `3. Type: "${type}"`,
      "4. Brief descriptions",
      "5. Only best matches",
    ].join("\n");

    var result = await model.generateContent(promptText);
    const response = await result.response;
    const text = response.text().trim();

    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("type|"));

    const recommendations = {
      movies: type === "movie" ? [] : undefined,
      series: type === "series" ? [] : undefined,
    };

    for (const line of lines) {
      const [lineType, name, year, description, relevance] = line
        .split("|")
        .map((s) => s.trim());
      if (lineType === type && name && year) {
        const item = {
          name,
          year: parseInt(year),
          type,
          description,
          relevance,
          id: `ai_${type}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        };

        if (type === "movie") recommendations.movies.push(item);
        else if (type === "series") recommendations.series.push(item);
      }
    }

    result = { recommendations };
    aiRecommendationsCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result,
    });

    return result;
  } catch (error) {
    logError("AI recommendation error:", error);
    return {
      recommendations: {
        movies: type === "movie" ? [] : undefined,
        series: type === "series" ? [] : undefined,
      },
    };
  }
}

async function toStremioMeta(item, platform = "unknown") {
  if (!item.id || !item.name) {
    console.warn("Invalid item:", item);
    return null;
  }

  const type = item.type || (item.id.includes("movie") ? "movie" : "series");

  const tmdbData = await searchTMDB(item.name, type, item.year);

  if (!tmdbData || !tmdbData.poster || !tmdbData.imdb_id) {
    //logWithTime(`Skipping ${item.name} - no poster image or IMDB ID available`);
    return null;
  }

  const meta = {
    id: tmdbData.imdb_id, // Use IMDB ID as the primary identifier
    type: type,
    name: item.name,
    description:
      platform === "android-tv"
        ? (tmdbData.overview || item.description || "").slice(0, 200)
        : tmdbData.overview || item.description || "",
    year: parseInt(item.year) || 0,
    poster:
      platform === "android-tv"
        ? tmdbData.poster.replace("/w500/", "/w342/")
        : tmdbData.poster,
    background: tmdbData.backdrop,
    posterShape: "regular",
  };

  if (tmdbData.genres && tmdbData.genres.length > 0) {
    meta.genres = tmdbData.genres.map((id) => TMDB_GENRES[id]).filter(Boolean);
  }

  return meta;
}

async function warmupCache(query) {
  try {
    const aiResponse = await getAIRecommendations(query, "movie");
    if (aiResponse) {
      //logWithTime(`Cache warmed up for: ${query} (movie)`);
    }
  } catch (error) {}

  try {
    const aiResponse = await getAIRecommendations(query, "series");
    if (aiResponse) {
      //logWithTime(`Cache warmed up for: ${query} (series)`);
    }
  } catch (error) {}
}

function detectPlatform(extra = {}) {
  if (extra.headers?.["stremio-platform"]) {
    return extra.headers["stremio-platform"];
  }

  const userAgent = (
    extra.userAgent ||
    extra.headers?.["stremio-user-agent"] ||
    ""
  ).toLowerCase();

  if (
    userAgent.includes("android tv") ||
    userAgent.includes("chromecast") ||
    userAgent.includes("androidtv")
  ) {
    return "android-tv";
  }

  if (
    userAgent.includes("android") ||
    userAgent.includes("mobile") ||
    userAgent.includes("phone")
  ) {
    return "mobile";
  }

  if (
    userAgent.includes("windows") ||
    userAgent.includes("macintosh") ||
    userAgent.includes("linux")
  ) {
    return "desktop";
  }

  return "unknown";
}

// Add this function back before the catalog handler
function sortByYear(a, b) {
  const yearA = parseInt(a.year) || 0;
  const yearB = parseInt(b.year) || 0;
  return yearB - yearA; // Descending order (newest first)
}

// Update the catalog handler with performance measurements
builder.defineCatalogHandler(async function (args) {
  const startTime = Date.now();
  const { type, extra } = args;
  const platform = detectPlatform(extra);
  const searchQuery = extra?.search;

  if (!searchQuery) return { metas: [] };

  const intent = determineIntentFromKeywords(searchQuery);
  if (intent !== "ambiguous" && intent !== type) {
    return { metas: [] };
  }

  try {
    const aiStartTime = Date.now();
    const aiResponse = await getAIRecommendations(searchQuery, type);
    measureTime(aiStartTime, "AI Recommendations");

    const recommendations =
      (type === "movie"
        ? aiResponse.recommendations.movies
        : aiResponse.recommendations.series
      )
        ?.sort(sortByYear)
        .slice(0, 10) || []; // Limit to top 10 results

    // Process all recommendations in parallel instead of batches
    const metaPromises = recommendations.map((item) =>
      toStremioMeta(item, platform)
    );
    const metas = (await Promise.all(metaPromises)).filter(Boolean);

    measureTime(startTime, "Total catalog processing");
    return { metas };
  } catch (error) {
    console.error("Search processing error:", error);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async function (args) {
  const { type, id } = args;
  logWithTime("Meta handler called with args:", args);

  try {
    // Search TMDB using the IMDB ID
    const tmdbData = await searchTMDB(id, type);
    if (tmdbData) {
      const meta = {
        id: tmdbData.imdb_id,
        type: type,
        name: tmdbData.title || tmdbData.name,
        description: tmdbData.overview,
        year: parseInt(tmdbData.release_date || tmdbData.first_air_date) || 0,
        poster: tmdbData.poster,
        background: tmdbData.backdrop,
        posterShape: "regular",
      };

      if (tmdbData.genres) {
        meta.genres = tmdbData.genres
          .map((id) => TMDB_GENRES[id])
          .filter(Boolean);
      }

      return { meta };
    }
  } catch (error) {
    logError("Meta Error:", error);
  }

  return { meta: null };
});

const TMDB_GENRES = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

const addonInterface = builder.getInterface();
module.exports = addonInterface;
