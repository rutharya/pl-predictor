/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { setGlobalOptions } from "firebase-functions";
import { onRequest } from "firebase-functions/https";
// import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

import { Timestamp, FieldValue } from "firebase-admin/firestore";

// data models
// TypeScript interfaces
// interface MatchResult {
//   fixtureId: string;
//   homeScore: number;
//   awayScore: number;
// }

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  kickoffTime: Timestamp;
  predictionDeadline: Timestamp;
  gameweek: number;
  status: string;
  homeScore?: number;
  awayScore?: number;
}

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

export const helloWorld = onRequest((request, response) => {
  logger.info("Hello logs!", { structuredData: true });
  response.send("Hello from Firebase!");
});

/**
 * An HTTP-triggered function to read the fixtures.json file,
 * parse it, and save the data to a 'fixtures' collection in Firestore.
 */
export const importFixtures = onRequest(
  // It's best practice to define options like timeout per function.
  // We give this function a longer timeout in case the import is large.
  { timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const db = admin.firestore();
      // 1. Construct the file path and read the local JSON file.
      // This is a more robust way to handle files in TypeScript/Node.js.
      const fixturesPath = path.join(__dirname, "../fixtures.json");
      const fixturesFile = fs.readFileSync(fixturesPath, "utf8");
      const fixturesData = JSON.parse(fixturesFile);
      const allFixtures = fixturesData.fixtures;

      const teamsPath = path.join(__dirname, "../teams.json");
      const teamsFile = fs.readFileSync(teamsPath, "utf8");
      const teams = JSON.parse(teamsFile);
      const teamsByCode: { [key: string]: any } = {};
      teams.forEach((team: any) => {
        teamsByCode[team.code] = team;
      });

      const batch = db.batch();
      let fixturesCount = 0;

      logger.info(`Found ${allFixtures.length} gameweeks to process.`);

      // 2. Loop through each matchday in the JSON
      allFixtures.forEach((gameweekData: any) => {
        const gameweek = parseInt(gameweekData.matchday.split(" ")[1], 10);

        // 3. Loop through each match in the gameweek
        gameweekData.matches.forEach((match: any) => {
          // 4. Parse the date and time, assuming the year 2025.
          // The time is parsed as UTC to avoid timezone issues.

          const [day, month, year] = match.date.split("/");
          const formatted = `${month}/${day}/${year}`;
          const [hours, minutes] = match.time.split(":");

          const kickoffDate = new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hours) - 1, // to account for UK time
            parseInt(minutes)
          );

          if (isNaN(kickoffDate.getTime())) {
            logger.warn(`Skipping fixture with invalid date: ${formatted}`);
            return; // Skips this iteration
          }

          const ukKickoff = new Date(kickoffDate.getTime() - 60 * 60 * 1000);
          const kickoffTime = Timestamp.fromDate(ukKickoff);

          // Set the prediction deadline to be 1 hour before kickoff.
          const predictionDeadline = Timestamp.fromMillis(
            kickoffTime.toMillis() - 60 * 60 * 1000
          );

          // 5. Create a readable, unique Fixture ID
          const homeTC = teamsByCode[match.home_team].shortName;
          const awayTC = teamsByCode[match.away_team].shortName;
          const fixtureId = `GW${gameweek}-${homeTC}-${awayTC}`;

          // 6. Define the Firestore document
          const fixtureRef = db.collection("fix").doc(fixtureId);
          const fixtureDoc = {
            homeTeam: match.home_team,
            awayTeam: match.away_team,
            kickoffTime: kickoffTime,
            predictionDeadline: predictionDeadline,
            gameweek: gameweek,
            status: "upcoming",
            homeScore: null,
            awayScore: null,
          };

          // 7. Add the operation to a batch for efficient writing
          batch.set(fixtureRef, fixtureDoc);
          fixturesCount++;
        });
      });

      //   8. Commit the batch write to Firestore
      await batch.commit();

      const successMessage = `Successfully imported ${fixturesCount} fixtures.`;
      logger.info(successMessage);
      res.status(200).send(successMessage);
    } catch (error) {
      logger.error("Error importing fixtures:", error);
      res.status(500).send("An error occurred while importing fixtures.");
    }
  }
);

/**
 * 5. UPDATE FIXTURE SCHEDULE (HTTP Trigger)
 * Endpoint: /updateFixtureSchedule
 * Updates fixture kickoff time and prediction deadline
 */
export const updateFixtureSchedule = onRequest(
  { timeoutSeconds: 300 },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).send("Method not allowed. Use POST.");
        return;
      }

      const { fixtureId, newKickoffTime } = req.body;

      // Validate input
      if (!fixtureId || !newKickoffTime) {
        res
          .status(400)
          .send(
            "Invalid input. Please provide fixtureId and newKickoffTime (ISO string or timestamp)."
          );
        return;
      }

      const db = admin.firestore();
      const fixtureRef = db.collection("fix").doc(fixtureId);
      const fixtureDoc = await fixtureRef.get();

      if (!fixtureDoc.exists) {
        res.status(404).send(`Fixture ${fixtureId} not found.`);
        return;
      }

      const fixture = fixtureDoc.data() as Fixture;
      console.log("ruthar : found fixture");
      console.log(fixture.homeTeam);

      // Convert new kickoff time to Firestore Timestamp
      let newKickoffTimestamp: Timestamp;

      if (typeof newKickoffTime === "string") {
        // Parse ISO string or date string
        const parsedDate = new Date(newKickoffTime);
        console.log("ruthar : parsed Date = ", parsedDate.toISOString());
        if (isNaN(parsedDate.getTime())) {
          res
            .status(400)
            .send(
              "Invalid date format. Please provide a valid ISO date string."
            );
          return;
        }
        newKickoffTimestamp = Timestamp.fromDate(parsedDate);
        console.log("ruthar - new kick off time - ", newKickoffTimestamp);
      } else if (typeof newKickoffTime === "number") {
        // Unix timestamp in milliseconds
        newKickoffTimestamp = Timestamp.fromMillis(newKickoffTime);
      } else {
        res
          .status(400)
          .send(
            "Invalid date format. Please provide ISO string or Unix timestamp."
          );
        return;
      }

      // Calculate new prediction deadline (1 hour before kickoff)
      const newPredictionDeadline = Timestamp.fromMillis(
        newKickoffTimestamp.toMillis() - 60 * 60 * 1000
      );

      // Check if fixture has already started or finished
      if (fixture.status === "finished") {
        res.status(400).send("Cannot update schedule for a finished fixture.");
        return;
      }

      // Store old times for logging
      const oldKickoffTime = fixture.kickoffTime;
      const oldDeadline = fixture.predictionDeadline;

      // Update the fixture
      await fixtureRef.update({
        kickoffTime: newKickoffTimestamp,
        predictionDeadline: newPredictionDeadline,
        updatedAt: Timestamp.now(),
        scheduleHistory: FieldValue.arrayUnion({
          oldKickoffTime,
          newKickoffTime: newKickoffTimestamp,
          updatedAt: Timestamp.now(),
          reason: "Manual schedule update",
        }),
      });

      const logMessage = `Updated fixture ${fixtureId} schedule: ${fixture.homeTeam} vs ${fixture.awayTeam}`;
      logger.info(logMessage, {
        fixtureId,
        oldKickoffTime: oldKickoffTime.toDate().toISOString(),
        newKickoffTime: newKickoffTimestamp.toDate().toISOString(),
        oldDeadline: oldDeadline.toDate().toISOString(),
        newDeadline: newPredictionDeadline.toDate().toISOString(),
      });

      res.status(200).json({
        success: true,
        message: `Successfully updated schedule for ${fixtureId}`,
        fixture: {
          id: fixtureId,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          oldKickoffTime: oldKickoffTime.toDate().toISOString(),
          newKickoffTime: newKickoffTimestamp.toDate().toISOString(),
          oldPredictionDeadline: oldDeadline.toDate().toISOString(),
          newPredictionDeadline: newPredictionDeadline.toDate().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Error updating fixture schedule:", error);
      res
        .status(500)
        .send("An error occurred while updating the fixture schedule.");
    }
  }
);

/**
 * 7. GET FIXTURE BY ID (HTTP Trigger)
 * Endpoint: /getFixture?id=GW15-MUN-LIV
 * OR: /getFixture/GW15-MUN-LIV
 */
export const getFixture = onRequest(
  { timeoutSeconds: 60 },
  async (req, res) => {
    try {
      // Allow CORS for testing
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.status(200).send("");
        return;
      }

      // Only allow GET requests
      if (req.method !== "GET") {
        res.status(405).send("Method not allowed. Use GET.");
        return;
      }

      // Get fixture ID from query parameter or path
      let fixtureId = (req.query.id as string) || req.path.split("/").pop();

      if (!fixtureId || fixtureId === "getFixture") {
        res
          .status(400)
          .send(
            "Missing fixture ID. Use: /getFixture?id=GW15-MUN-LIV or /getFixture/GW15-MUN-LIV"
          );
        return;
      }

      // Clean up fixture ID (remove leading slash if present)
      fixtureId = fixtureId.replace(/^\//, "");

      const db = admin.firestore();
      const fixtureRef = db.collection("fix").doc(fixtureId);
      const fixtureDoc = await fixtureRef.get();

      if (!fixtureDoc.exists) {
        res.status(404).json({
          success: false,
          message: `Fixture ${fixtureId} not found.`,
          fixtureId: fixtureId,
        });
        return;
      }

      const fixtureData = fixtureDoc.data() as Fixture;

      // Convert Firestore Timestamps to ISO strings for JSON response
      // const responseData = {
      //   id: fixtureDoc.id,
      //   ...fixtureData,
      //   kickoffTime: fixtureData.kickoffTime.toDate().toISOString(),
      //   predictionDeadline: fixtureData.predictionDeadline.toDate().toISOString(),
      //   // Include any additional timestamp fields
      //   ...(fixtureData.updatedAt && {
      //     updatedAt: (fixtureData.updatedAt as Timestamp).toDate().toISOString()
      //   })
      // };
      console.log(fixtureData);
      logger.info(
        `Retrieved fixture ${fixtureId}: ${fixtureData.homeTeam} vs ${fixtureData.awayTeam}`
      );
      let ts = fixtureData.kickoffTime.toDate();

      const humanReadable = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZoneName: "short", // or 'long' for full name
      }).format(ts);

      console.log(humanReadable);

      logger.info(
        `kick off time - ${fixtureData.kickoffTime
          .toDate()
          .toLocaleString("en-US", {
            weekday: "long", // optional: "Monday"
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })}`
      );

      res.status(200).json({
        success: true,
        fixture: fixtureData,
      });
    } catch (error: any) {
      logger.error("Error retrieving fixture:", error);
      res.status(500).json({
        success: false,
        message: "An error occurred while retrieving the fixture.",
        error: error.message,
      });
    }
  }
);

/**
 * 8. GET ALL FIXTURES FOR GAMEWEEK (HTTP Trigger)
 * Endpoint: /getGameweekFixtures?gw=15
 */
// export const getGameweekFixtures = onRequest(
//   { timeoutSeconds: 60 },
//   async (req, res) => {
//     try {
//       // Allow CORS for testing
//       res.set("Access-Control-Allow-Origin", "*");
//       res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
//       res.set("Access-Control-Allow-Headers", "Content-Type");

//       if (req.method === "OPTIONS") {
//         res.status(200).send("");
//         return;
//       }

//       if (req.method !== "GET") {
//         res.status(405).send("Method not allowed. Use GET.");
//         return;
//       }

//       const gameweek = parseInt(req.query.gw as string, 10);

//       if (!gameweek || isNaN(gameweek) || gameweek < 1 || gameweek > 38) {
//         res.status(400).json({
//           success: false,
//           message:
//             "Invalid gameweek. Please provide a valid gameweek number (1-38).",
//         });
//         return;
//       }

//       const db = admin.firestore();
//       const fixturesQuery = await db
//         .collection("fixtures")
//         .where("gameweek", "==", gameweek)
//         .orderBy("kickoffTime", "asc")
//         .get();

//       if (fixturesQuery.empty) {
//         res.status(404).json({
//           success: false,
//           message: `No fixtures found for gameweek ${gameweek}.`,
//           gameweek: gameweek,
//         });
//         return;
//       }

//       const fixtures = fixturesQuery.docs.map((doc) => {
//         const data = doc.data() as Fixture;
//         return {
//           id: doc.id,
//           ...data,
//           kickoffTime: data.kickoffTime.toDate().toISOString(),
//           predictionDeadline: data.predictionDeadline.toDate().toISOString(),
//           ...(data.updatedAt && {
//             updatedAt: (data.updatedAt as Timestamp).toDate().toISOString(),
//           }),
//         };
//       });

//       logger.info(
//         `Retrieved ${fixtures.length} fixtures for gameweek ${gameweek}`
//       );

//       res.status(200).json({
//         success: true,
//         gameweek: gameweek,
//         count: fixtures.length,
//         fixtures: fixtures,
//       });
//     } catch (error:any) {
//       logger.error("Error retrieving gameweek fixtures:", error);
//       res.status(500).json({
//         success: false,
//         message: "An error occurred while retrieving gameweek fixtures.",
//         error: error.message,
//       });
//     }
//   }
// );

/**
 * 9. GET ALL FIXTURES (HTTP Trigger) - For testing/debugging
 * Endpoint: /getAllFixtures?limit=50
 */
// export const getAllFixtures = onRequest(
//   { timeoutSeconds: 120 },
//   async (req, res) => {
//     try {
//       // Allow CORS for testing
//       res.set("Access-Control-Allow-Origin", "*");
//       res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
//       res.set("Access-Control-Allow-Headers", "Content-Type");

//       if (req.method === "OPTIONS") {
//         res.status(200).send("");
//         return;
//       }

//       if (req.method !== "GET") {
//         res.status(405).send("Method not allowed. Use GET.");
//         return;
//       }

//       const limit = parseInt(req.query.limit as string, 10) || 50;
//       const status = req.query.status as string; // Optional filter by status

//       const db = admin.firestore();
//       let query = db
//         .collection("fixtures")
//         .orderBy("gameweek", "asc")
//         .orderBy("kickoffTime", "asc");

//       // Add status filter if provided
//       if (status && ["upcoming", "finished", "live"].includes(status)) {
//         query = query.where("status", "==", status);
//       }

//       // Apply limit
//       query = query.limit(Math.min(limit, 200)); // Cap at 200 for performance

//       const fixturesQuery = await query.get();

//       const fixtures = fixturesQuery.docs.map((doc) => {
//         const data = doc.data() as Fixture;
//         return {
//           id: doc.id,
//           ...data,
//           kickoffTime: data.kickoffTime.toDate().toISOString(),
//           predictionDeadline: data.predictionDeadline.toDate().toISOString(),
//           ...(data.updatedAt && {
//             updatedAt: (data.updatedAt as Timestamp).toDate().toISOString(),
//           }),
//         };
//       });

//       logger.info(
//         `Retrieved ${fixtures.length} fixtures (limit: ${limit}, status: ${
//           status || "all"
//         })`
//       );

//       res.status(200).json({
//         success: true,
//         count: fixtures.length,
//         limit: limit,
//         ...(status && { statusFilter: status }),
//         fixtures: fixtures,
//       });
//     } catch (error: any) {
//       logger.error("Error retrieving all fixtures:", error);
//       res.status(500).json({
//         success: false,
//         message: "An error occurred while retrieving fixtures.",
//         error: error.message,
//       });
//     }
//   }
// );

/**
 * An HTTP-triggered function to read the fixtures.json file,
 * parse it, and save the data to a 'fixtures' collection in Firestore.
 */
export const importTeams = onRequest(
  { timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const db = admin.firestore();
      const teamsPath = path.join(__dirname, "../teams.json");
      const teamsFile = fs.readFileSync(teamsPath, "utf8");
      const teams = JSON.parse(teamsFile);

      const teamsCollection = db.collection("teams");

      // 2. Create a batch
      const batch = db.batch();

      // 3. Loop through the teams and add them to the batch
      teams.forEach((team: any) => {
        // Use the unique 'shortName' (e.g., "ARS") as the document ID
        const docRef = teamsCollection.doc(team.shortName);
        batch.set(docRef, team);
      });

      // 4. Commit the batch to Firestore
      await batch.commit();

      logger.info(`Successfully imported ${teams.length} teams.`);
      res.status(200).send(`Successfully imported ${teams.length} teams.`);
    } catch (error) {
      logger.error("Error importing Teams:", error);
      res.status(500).send("An error occurred while importing Teams.");
    }
  }
);

// --- START of new code block ---
/**
 * Helper function to calculate points based on prediction vs actual result
 */
// function calculatePoints(
//   homePrediction: number,
//   awayPrediction: number,
//   homeScore: number,
//   awayScore: number
// ): number {
//   // 3 points for exact score match
//   if (homePrediction === homeScore && awayPrediction === awayScore) {
//     return 3;
//   }

//   // 1 point for correct outcome (win/draw/loss)
//   const predictedOutcome = getOutcome(homePrediction, awayPrediction);
//   const actualOutcome = getOutcome(homeScore, awayScore);

//   if (predictedOutcome === actualOutcome) {
//     return 1;
//   }

//   // 0 points for wrong prediction
//   return 0;
// }

// /**
//  * Helper function to determine match outcome
//  */
// function getOutcome(homeScore: number, awayScore: number): string {
//   if (homeScore > awayScore) return "H"; // Home win
//   if (homeScore < awayScore) return "A"; // Away win
//   return "D"; // Draw
// }

// /**
//  * Helper function to validate score inputs
//  */
// function isValidScore(score: number): boolean {
//   return Number.isInteger(score) && score >= 0 && score <= 20;
// }

// Check if the code is running in the local emulator environment
if (process.env.FUNCTIONS_EMULATOR) {
  logger.info(
    "Local environment detected. Initializing admin SDK with service account."
  );
  // IMPORTANT: Replace with the actual path to YOUR service account key
  const serviceAccount = require("/Users/ruthvikarya/.firebase/keys/pl-predictor-5c8e6-firebase-adminsdk-fbsvc-85cffa06a8.json");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  // In production, initialize without arguments.
  // It will automatically discover credentials.
  admin.initializeApp();
}

// --- END of new code block ---
