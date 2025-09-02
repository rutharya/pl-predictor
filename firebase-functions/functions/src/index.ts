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
import { onDocumentUpdated } from "firebase-functions/firestore";

// Collection names CONSTS
const USERS_COLLECTION = "users";
const TEAMS_COLLECTION = "teams";
const FIXTURES_COLLECTION = "fixtures";
const PREDICTIONS_COLLECTION = "predictions";
const PREDICTIONS_COLLECTION_TEST = "predictions-test";

// const FIXTURES_TEST_COLLECTION = "fix";

// data models
// TypeScript interfaces
interface MatchResult {
  fixtureId: string;
  homeScore: number;
  awayScore: number;
}

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  kickoffTime: Timestamp;
  predictionDeadline: Timestamp;
  gameweek: number;
  status: string;
  homeScore?: number;
  awayScore?: number;
  updatedAt?: Timestamp;
}

interface Prediction {
  fixtureId: string;
  gameweek: number;
  userId: string;
  homeScore: number;
  awayScore: number;
  isSubmitted?: boolean;
  pointsEarned?: number;
  calculatedAt?: Timestamp;
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
 * 1. Import All Teams
 * An HTTP-triggered function to read the fixtures.json file,
 * parse it, and save the data to a 'fixtures' collection in Firestore.
 */
export const importTeams = onRequest(
  { timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const db = admin.firestore();
      const teamsPath = path.join(__dirname, "../data/teams.json");
      const teamsFile = fs.readFileSync(teamsPath, "utf8");
      const teams = JSON.parse(teamsFile);

      const teamsCollection = db.collection(TEAMS_COLLECTION);

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

/**
 * 2. Import All Fixtures
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
      const fixturesPath = path.join(__dirname, "../data/fixtures.json");
      const fixturesFile = fs.readFileSync(fixturesPath, "utf8");
      const fixturesData = JSON.parse(fixturesFile);
      const allFixtures = fixturesData.fixtures;

      const teamsPath = path.join(__dirname, "../data/teams.json");
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
          const fixtureRef = db.collection(FIXTURES_COLLECTION).doc(fixtureId);
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
 * 3. UPDATE FIXTURE SCHEDULE (HTTP Trigger)
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
      const fixtureRef = db.collection(FIXTURES_COLLECTION).doc(fixtureId);
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
 * 4. GET FIXTURE BY ID (HTTP Trigger)
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
      const fixtureRef = db.collection(FIXTURES_COLLECTION).doc(fixtureId);
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
 * 5. GET ALL FIXTURES FOR GAMEWEEK (HTTP Trigger)
 * Endpoint: /getGameweekFixtures?gw=15
 */
export const getGameweekFixtures = onRequest(
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

      if (req.method !== "GET") {
        res.status(405).send("Method not allowed. Use GET.");
        return;
      }

      const gameweek = parseInt(req.query.gw as string, 10);

      if (!gameweek || isNaN(gameweek) || gameweek < 1 || gameweek > 38) {
        res.status(400).json({
          success: false,
          message:
            "Invalid gameweek. Please provide a valid gameweek number (1-38).",
        });
        return;
      }

      const db = admin.firestore();
      const fixturesQuery = await db
        .collection(FIXTURES_COLLECTION)
        .where("gameweek", "==", gameweek)
        .orderBy("kickoffTime", "asc")
        .get();

      if (fixturesQuery.empty) {
        res.status(404).json({
          success: false,
          message: `No fixtures found for gameweek ${gameweek}.`,
          gameweek: gameweek,
        });
        return;
      }

      const fixtures = fixturesQuery.docs.map((doc) => {
        const data = doc.data() as Fixture;
        return {
          id: doc.id,
          ...data,
          kickoffTime: data.kickoffTime.toDate().toISOString(),
          predictionDeadline: data.predictionDeadline.toDate().toISOString(),
          ...(data.updatedAt && {
            updatedAt: (data.updatedAt as Timestamp).toDate().toISOString(),
          }),
        };
      });

      logger.info(
        `Retrieved ${fixtures.length} fixtures for gameweek ${gameweek}`
      );

      res.status(200).json({
        success: true,
        gameweek: gameweek,
        count: fixtures.length,
        fixtures: fixtures,
      });
    } catch (error: any) {
      logger.error("Error retrieving gameweek fixtures:", error);
      res.status(500).json({
        success: false,
        message: "An error occurred while retrieving gameweek fixtures.",
        error: error.message,
      });
    }
  }
);

/**
 * Helper function to calculate points based on prediction vs actual result
 */

function calculatePoints(
  homePrediction: number,
  awayPrediction: number,
  homeScore: number,
  awayScore: number
): number {
  // 3 points for exact score match
  logger.log(`rutahr prediction = ${homePrediction} - ${awayPrediction}`);
  logger.log(`ruthar actual = ${homeScore} - ${awayScore}`);

  logger.log(`ruthar - type - homePrediction = ${typeof homePrediction}`);
  logger.log(`ruthar - value - homePrediction = ${homePrediction}`);
  logger.log(`ruthar - type - homeScore = ${typeof homeScore}`);
  logger.log(`ruthar - value - home score = ${homeScore}`);

  // Convert all to numbers to avoid type issues
  const homePred = Number(homePrediction);
  const awayPred = Number(awayPrediction);
  const homeActual = Number(homeScore);
  const awayActual = Number(awayScore);

  logger.info(
    `[DEBUG] Prediction: ${homePred}-${awayPred} (types: ${typeof homePred}, ${typeof awayPred})`
  );
  logger.info(
    `[DEBUG] Actual: ${homeActual}-${awayActual} (types: ${typeof homeActual}, ${typeof awayActual})`
  );

  if (homePrediction == homeScore) {
    logger.log("home predicitons match");
  }
  if (awayPrediction == awayScore) {
    logger.log("away scores match");
  }

  // 3 points for exact score match
  if (homePred === homeActual && awayPred === awayActual) {
    logger.info(`[DEBUG] EXACT MATCH! Returning 3 points`);
    return 3;
  }

  if (homePrediction === homeScore && awayPrediction === awayScore) {
    logger.log("ruthar - home and away scores are identical, returning 3");
    return 3;
  }

  // 1 point for correct outcome (win/draw/loss)
  const predictedOutcome = getOutcome(homePrediction, awayPrediction);
  const actualOutcome = getOutcome(homeScore, awayScore);

  if (predictedOutcome === actualOutcome) {
    logger.log("returning 1?? ");
    return 1;
  }

  // 0 points for wrong prediction
  return 0;
}

// /**
//  * Helper function to determine match outcome
//  */
function getOutcome(homeScore: number, awayScore: number): string {
  if (homeScore > awayScore) return "H"; // Home win
  if (homeScore < awayScore) return "A"; // Away win
  return "D"; // Draw
}

// /**
//  * Helper function to validate score inputs
//  */
function isValidScore(score: number): boolean {
  return Number.isInteger(score) && score >= 0 && score <= 20;
}

/**
 * 6. UPDATE MATCH RESULT FUNCTION (HTTP Trigger)
 * Endpoint: /updateMatchResult
 */
export const updateMatchResult = onRequest(
  { timeoutSeconds: 300 },
  async (req, res) => {
    try {
      // Only allow POST requests
      if (req.method !== "POST") {
        res.status(405).send("Method not allowed. Use POST.");
        return;
      }

      const { fixtureId, homeScore, awayScore }: MatchResult = req.body;

      // Validate input
      if (!fixtureId || !isValidScore(homeScore) || !isValidScore(awayScore)) {
        res
          .status(400)
          .send(
            "Invalid input. Please provide valid fixtureId, homeScore, and awayScore."
          );
        return;
      }

      const db = admin.firestore();
      const fixtureRef = db.collection(FIXTURES_COLLECTION).doc(fixtureId);
      const fixtureDoc = await fixtureRef.get();

      if (!fixtureDoc.exists) {
        res.status(404).send(`Fixture ${fixtureId} not found.`);
        return;
      }

      const fixture = fixtureDoc.data() as Fixture;

      // Update fixture with result
      await fixtureRef.update({
        homeScore: homeScore,
        awayScore: awayScore,
        status: "finished",
        updatedAt: Timestamp.now(),
      });

      logger.info(
        `Updated fixture ${fixtureId}: ${fixture.homeTeam} ${homeScore}-${awayScore} ${fixture.awayTeam}`
      );

      res.status(200).json({
        success: true,
        message: `Successfully updated ${fixtureId}`,
        fixture: {
          ...fixture,
          homeScore,
          awayScore,
          status: "finished",
        },
      });
    } catch (error) {
      logger.error("Error updating match result:", error);
      res
        .status(500)
        .send("An error occurred while updating the match result.");
    }
  }
);

/**
 * 7. CALCULATE POINTS FUNCTION (Firestore Trigger)
 * Trigger: When fixture document is updated
 */
export const calculatePointsOnFixtureUpdate = onDocumentUpdated(
  `fixtures/{fixtureId}`,
  async (event) => {
    try {
      const beforeData = event.data?.before.data();
      const afterData = event.data?.after.data();
      const fixtureId = event.params.fixtureId;

      if (!beforeData || !afterData) {
        logger.warn(`No data found for fixture ${fixtureId}`);
        return;
      }

      // Check if status changed to "finished" AND scores are not null
      const statusChanged =
        beforeData.status !== "finished" && afterData.status === "finished";
      const hasScores =
        afterData.homeScore !== null && afterData.awayScore !== null;

      if (!statusChanged || !hasScores) {
        logger.info(
          `Skipping point calculation for fixture ${fixtureId} - not a valid finish update`
        );
        return;
      }

      logger.info(`Starting point calculation for fixture ${fixtureId}`);

      const db = admin.firestore();
      const { homeScore, awayScore, gameweek } = afterData;

      // Get all predictions for this fixture
      const predictionsQuery = await db
        .collection(PREDICTIONS_COLLECTION)
        .where("fixtureId", "==", fixtureId)
        .get();

      const predictions = predictionsQuery.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      logger.info(
        `Found ${predictions.length} predictions for fixture ${fixtureId}`
      );

      logger.info(predictions[0]);

      if (predictions.length === 0) {
        logger.info(`No predictions found for fixture ${fixtureId}`);
        return;
      }

      // Process predictions in batches
      await processPredictionsInBatches(
        predictions,
        homeScore,
        awayScore,
        fixtureId,
        gameweek
      );

      // Update gameweek leaderboard
      // await updateGameweekLeaderboard(gameweek);

      logger.info(`Successfully calculated points for fixture ${fixtureId}`);
    } catch (error) {
      logger.error("Error calculating points:", error);
    }
  }
);

/**
 * Helper function to process predictions in batches
 */
async function processPredictionsInBatches(
  predictions: any[],
  homeScore: number,
  awayScore: number,
  fixtureId: string,
  gameweek: number
): Promise<void> {
  const db = admin.firestore();
  const BATCH_SIZE = 500;

  for (let i = 0; i < predictions.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchPredictions = predictions.slice(i, i + BATCH_SIZE);

    for (const prediction of batchPredictions) {
      // Skip if already calculated
      if (prediction.pointsEarned !== null && prediction.calculatedAt) {
        continue;
      }

      const points = calculatePoints(
        parseInt(prediction.homeScore),
        parseInt(prediction.awayScore),
        homeScore,
        awayScore
      );
      logger.log("ruthar - points earned");
      logger.log(points);
      // Update prediction with points
      const predictionRef = db
        .collection(PREDICTIONS_COLLECTION)
        .doc(prediction.id);
      batch.update(predictionRef, {
        pointsEarned: points,
        calculatedAt: Timestamp.now(),
      });

      // Update user stats
      const userRef = db.collection(USERS_COLLECTION).doc(prediction.userId);
      // const increment = admin.firestore.FieldValue.increment(1);
      // const pointsIncrement = admin.firestore.FieldValue.increment(points);

      // Read current user stats
      const userDoc = await userRef.get();

      const currentStats = userDoc.data()?.stats || {
        totalPoints: 0,
        exactPredictions: 0,
        correctPredictions: 0,
        wrongPredictions: 0,
        processedPredictionsCount: 0,
        accuracyRate: 0,
      };

      // Calculate new values
      const newStats = {
        totalPoints: parseInt(currentStats.totalPoints) + points,
        processedPredictionsCount:
          parseInt(currentStats.processedPredictionsCount) + 1,
        exactPredictions:
          parseInt(currentStats.exactPredictions) + (points === 3 ? 1 : 0),
        correctPredictions:
          parseInt(currentStats.correctPredictions) + (points === 1 ? 1 : 0),
        wrongPredictions:
          parseInt(currentStats.wrongPredictions) + (points === 0 ? 1 : 0),
        accuracyRate: parseFloat(currentStats.accuracyRate),
      };

      // update the accuracy rate.. based on new stats
      newStats.accuracyRate = Math.round(
        ((newStats.correctPredictions + newStats.exactPredictions) /
          newStats.processedPredictionsCount) *
          100
      );

      const updateData = { stats: newStats };
      // const updateData: any = {
      //   stats: {
      //     totalPoints: pointsIncrement,
      //     processedPredictionsCount: increment,
      //   },
      // };

      // if (points === 3) {
      //   updateData.stats.exactPredictions = increment;
      // } else if (points === 1) {
      //   updateData.stats.correctPredictions = increment;
      // } else {
      //   updateData.stats.wrongPredictions = increment;
      // }

      batch.update(userRef, updateData);
    }

    await batch.commit();
    logger.info(
      `Processed batch ${
        Math.floor(i / BATCH_SIZE) + 1
      } for fixture ${fixtureId}`
    );
  }
}

// Import predictions for testing...
/**
 * 9. Import All Predictions
 * An HTTP-triggered function to read the fixtures.json file,
 * parse it, and save the data to a 'predictions2' collection in Firestore.
 */
export const importPredictions = onRequest(
  // It's best practice to define options like timeout per function.
  // We give this function a longer timeout in case the import is large.
  { timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const db = admin.firestore();
      // 1. Construct the file path and read the local JSON file.
      // This is a more robust way to handle files in TypeScript/Node.js.
      const predictionsPath = path.join(
        __dirname,
        "../data/test_predictions.json"
      );
      const predictionsFile = fs.readFileSync(predictionsPath, "utf8");
      const predictionsData = JSON.parse(predictionsFile);
      const allPredictions = predictionsData.predictions;

      const predictionsCollection = db.collection(PREDICTIONS_COLLECTION_TEST);

      const batch = db.batch();
      console.log(allPredictions[0]);
      allPredictions.forEach((pred: Prediction) => {
        const predRef = predictionsCollection.doc(
          `${pred.fixtureId}-${pred.userId}`
        );
        batch.set(predRef, pred);
      });

      await batch.commit();
      logger.info(
        `Successfully imported ${allPredictions.length} predictions.`
      );
      res
        .status(200)
        .send(`Successfully imported ${allPredictions.length} predictions.`);
    } catch (error) {
      logger.error("Error importing predictions:", error);
      res.status(500).send("An error occurred while importing predictions.");
    }
  }
);
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
