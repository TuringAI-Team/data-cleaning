#!/usr/bin/env node
import chalk from "chalk";
import inquirer from "inquirer";
import { createSpinner } from "nanospinner";
import chalkAnimation from "chalk-animation";
import figlet from "figlet";
import "dotenv/config";
import {
  cleanData,
  formatData,
  getData,
  getDataFromFile,
  multithreads,
} from "./main.js";
import cliProgress from "cli-progress";
import delay from "delay";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import fs2 from "fs";
let id = "";

async function main() {
  await welcome();
  await delay(2000);
  console.clear();
  let actionToDo = await askActionToDo();
  console.log(chalk.green(`Action: ${actionToDo}`));
  if (actionToDo == "clean data") {
    let howGetData = await askHowGetData();
    id = randomUUID().slice(0, 8);
    if (howGetData === "table") {
      const table = await askForTable();
      const model = await askForModel();
      console.log(chalk.green(`Table: ${table}`));
      console.log(chalk.green(`Model: ${model}`));
      await delay(1000);
      console.clear();

      const bar = new cliProgress.SingleBar(
        {},
        cliProgress.Presets.shades_classic
      );
      const data = await getData(table, model, id, bar);
      bar.stop();
      if (!data) {
        console.clear();
        console.log(chalk.red("Error getting data"));
        return;
      }
    } else {
      const filePath = await askForFilePath();
      const table = await askForTable();
      console.log(chalk.green(`File Path: ${filePath}`));
      console.log(chalk.green(`Table: ${table}`));
      await delay(1000);
      console.clear();
      let spinner = createSpinner("Getting/formatting data");
      spinner.start();
      let data = await getDataFromFile(filePath, id);
      let formattedData = await formatData(data, table, id);
      spinner.stop();
      if (!formattedData) {
        console.clear();
        console.log(chalk.red("Error formatting data"));
        return;
      }
      console.clear();
      console.log(chalk.green("Data formatted successfully"));
      console.log(
        chalk.green(`Data saved to ./steps/${id}/formatted/data.json`)
      );
      await delay(1000);
      console.clear();
      let maxThreads = await askMaxThreads();
      console.clear();
      let bar = new cliProgress.SingleBar(
        {},
        cliProgress.Presets.shades_classic
      );
      bar.start(formattedData.length, 0);
      await multithreads(formattedData, id, parseInt(maxThreads), bar);
    }
  } else if (actionToDo == "view data") {
    console.clear();
    // read steps folder to get all ids that are the names of the folders
    let ids = await fs.readdir("./steps");
    // filter out non folders
    // ask which step to view
    const { id } = await inquirer.prompt([
      {
        type: "list",
        name: "id",
        message: "Which dataset do you want to view?",
        choices: ids,
      },
    ]);
    // ask for step to view
    const { step } = await inquirer.prompt([
      {
        type: "list",
        name: "step",
        message: "Which step do you want to view?",
        choices: ["raw", "formatted", "cleaned", "all"],
      },
    ]);
    console.clear();
    if (step === "all") {
      await viewStep(id, "raw");
      await viewStep(id, "formatted");
      await viewStep(id, "cleaned");
    } else {
      await viewStep(id, step);
    }
  } else if (actionToDo === "exit") {
    process.exit(0);
  }
}

async function viewStep(id, step) {
  // read the file
  let data = await fs.readFile(`./steps/${id}/${step}/data.json`, "utf8");
  data = JSON.parse(data);
  // print data from the file such as how many rows, created at, etc
  console.log(chalk.green(`Step: ${step}`));
  console.log(chalk.green(`Rows: ${data.length}`));
}

async function welcome() {
  const rainbowTitle = chalkAnimation.rainbow(
    figlet.textSync("Turing AI | Data Cleaner", {
      font: "Standard",
      horizontalLayout: "default",
      verticalLayout: "default",
    })
  );

  await delay(1000);
  rainbowTitle.stop();

  console.log(`
        This tool is designed for cleaning data for AI training.
        It will ask you a series of questions to help you clean your data
    `);
}

async function askActionToDo() {
  // clean data, view data, exit
  const { actionToDo } = await inquirer.prompt([
    {
      type: "list",
      name: "actionToDo",
      message: "What do you want to do?",
      choices: ["clean data", "view data", "exit"],
    },
  ]);
  return actionToDo;
}

async function askForTable() {
  const { table } = await inquirer.prompt([
    {
      type: "list",
      name: "table",
      message: "Which table do you want to clean?",
      choices: ["interactions_new", "dataset", "results"],
    },
  ]);
  return table;
}

async function askForModel() {
  const { model } = await inquirer.prompt([
    {
      // is string
      type: "input",
      name: "model",
      message: "Which model do you want to clean?",
      // add placeholder
      default: "gpt-4",
    },
  ]);
  return model;
}
async function askHowGetData() {
  // get data directly from supabase or upload csv, recommend csv
  // if csv, ask for file path
  // if supabase, ask for table and model
  const { howGetData } = await inquirer.prompt([
    {
      type: "list",
      name: "howGetData",
      message: "How do you want to get your data?",
      choices: ["csv", "table"],
    },
  ]);
  return howGetData;
}

async function askForFilePath() {
  // read data path to get default path
  let folder = "./data";
  // read folder
  let files = await fs.readdir(folder);
  // filter out non csv files
  files = files.filter((file) => file.includes(".csv"));
  // add folder to file name
  files = files.map((file) => `${folder}/${file}`);
  let defaultPath = files[0];
  const { filePath } = await inquirer.prompt([
    {
      // is string
      type: "input",
      name: "filePath",
      message: "What is the file path of your csv?",
      // add placeholder
      // default needs to be actual path at ../data/dataset.csv
      default: defaultPath,
    },
  ]);
  return filePath;
}

async function askMaxThreads() {
  // get cpu count
  // ask for max threads
  // default to cpu count
  const { maxThreads } = await inquirer.prompt([
    {
      // is string
      type: "input",
      name: "maxThreads",
      message: "What is the max number of threads you want to use?",
      // add placeholder
      // default needs to be actual path at ../data/dataset.csv
      default: "4",
    },
  ]);
  return maxThreads;
}

main();
