import supabase from "./supabase.js";
import delay from "delay";
import fs from "fs";
import Papa from "papaparse";
import axios from "axios";
import { randomUUID } from "crypto";

async function consolelog(...args) {
  console.log(...args);
  // save to file
  fs.appendFileSync("./log.txt", args.join(" ") + "\n");
}

export async function getData(
  table: string = "dataset",
  model: string = "gpt-4",
  id: string = "id",
  bar?: any
) {
  let pages = [];
  let modelKey = getModelKey(table);
  // change timeout to 2min

  let { data, error, count } = await supabase
    .from(table)
    .select("*")
    .eq(modelKey, model)
    .range(0, 1000);
  if (error) {
    consolelog(error);
    return;
  }
  bar?.start(count, 0);
  pages.push(data);

  while (data.length > 0) {
    await delay(1000);
    let { data, error } = await supabase
      .from(table)
      .select("*")
      .eq(modelKey, model)
      .range(pages.length * 1000, (pages.length + 1) * 1000);
    if (error) {
      consolelog(error);
      return;
    }
    pages.push(data);
    bar?.update(pages.length * 1000, { speed: "N/A" });
  }
  await saveData(pages, id, "raw");
  return pages;
}

export async function getDataFromFile(filePath: string, id: string = "id") {
  let data: any = fs.readFileSync(filePath, "utf-8");
  // convert this csv to json
  data = await parseCsvToJson(data);
  await saveData(data, id, "raw");
  return data;
}

async function saveData(data: any, id: string = "id", step: string) {
  let folder = `./steps/${id}/${step}`;
  if (!fs.existsSync(`./steps/${id}`)) {
    fs.mkdirSync(`./steps/${id}`);
  }
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }
  fs.writeFileSync(`${folder}/data.json`, JSON.stringify(data));
}
async function parseCsvToJson(csvString: string): Promise<object[]> {
  const { data } = await Papa.parse(csvString, { header: true });
  return data;
}

export async function formatData(data: any, table: string, id: string = "id") {
  let formattedData = [];
  for (let i = 0; i < data.length; i++) {
    let result = await formatObject(table, data[i]);
    formattedData.push({ ...result, id: randomUUID().slice(0, 8) });
  }
  await saveData(formattedData, id, "formatted");
  return formattedData;
}
let status = 0;
let cleanedDataFull = [];

export async function multithreads<T>(
  data: T[],
  id: string,
  maxThreads: number,
  progressBar: any
) {
  const chunkSize = Math.ceil(data.length / maxThreads);
  const chunks = [];

  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  status = 0;
  const promises = chunks.map((chunk, index) => {
    return new Promise<void>((resolve) => {
      setTimeout(async () => {
        await cleanData(chunk, id, progressBar);
        resolve();
      }, 0);
    });
  });

  await Promise.all(promises);
}

export async function cleanData(data: any, id: string = "id", bar?: any) {
  let cleanedData = [];
  for (let i = 0; i < data.length; i++) {
    await delay(500);
    let result = await cleanObject({
      input: data[i].input,
      output: data[i].output,
    });
    // try to parse the result
    console.clear();
    try {
      result = JSON.parse(result);
    } catch (error) {
      consolelog(`error: ${error}`);
      result = {};
    }
    status++;
    bar?.update(status, { speed: "N/A" });
    if (
      Object.keys(result).length === 0 ||
      result.input == "" ||
      result.output == ""
    )
      continue;
    result = { ...result, id: data[i].id };
    cleanedData.push(result);
    cleanedDataFull.push(result);
    await saveData(cleanedDataFull, id, "cleaning");
  }
  await saveData(cleanedDataFull, id, "cleaned");
  return cleanedDataFull;
}

async function cleanObject(object: any, retry = 0) {
  // remove model key
  delete object["model"];
  try {
    let response = await chatgpt([
      {
        role: "system",
        content: `The user is going to give you a chunk of a dataset containing an input and output. First decide if the data is valid for training a LLM. In case it is valid, JUST RETURN A NEW OBJECT WITH THE SAME INPUT AND OUTPUT CLEANED. CLEANED means you remove nicknames, keys or any personal information from the input and output, if there not any personal information in the input or output JUST RETURN THEM. DO NOT ADD EXPLANATIONS. \nIn case it is not valid for training a LLM, JUST RETURN AN OBJECT like this {"reason": "reason"}. The reason can be: conversational, images, irrelevant. \nconversational: the input or the output makes reference to previous messages, or the input asks for continuation. \nimages: the input or the output makes reference to attachments.\nirrelevant: the input or the output are irrelevant or not complex enough to be used for training a LLM.\nDO NOT ADD EXPLANATIONS`,
      },
      {
        role: "user",
        content: `${JSON.stringify(object)}`,
      },
    ]);
    response = response.replace("CLEANED: {", "{");
    response = response.replace("Valid.", "");
    if (response.includes('"output":{"reason":"conversational"}}')) {
      return '{"reason":"conversational"}';
    }
    if (response.includes('"output":{"reason":"images"}}')) {
      return '{"reason":"images"}';
    }
    if (response.includes('"output":{"reason":"irrelevant"}}')) {
      return '{"reason":"irrelevant"}';
    }
    return response;
  } catch (error) {
    if (retry >= 3) {
      return {};
    }
    return await cleanObject(object, retry + 1);
  }
}

async function chatgpt(messages: any) {
  let response = await axios({
    url: "https://api.pawan.krd/v1/chat/completions",
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAWAN_API_KEY}`,
      "Content-Type": "application/json",
    },
    proxy: {
      host: process.env.PROXY_HOST,
      port: 80,
      auth: {
        username: process.env.PROXY_USER,
        password: process.env.PROXY_PASS,
      },
      protocol: "http",
    },
    data: {
      model: "gpt-3.5-turbo",
      max_tokens: 2000,
      messages: messages,
      temperature: 0.1,
    },
  });
  if (!response.data.choices) {
    return {};
  }
  consolelog(`clean result: ${response.data.choices[0].message.content}`);
  if (response.data.choices[0].finish_reason == "content_filter") {
    return {};
  }
  let result = response.data.choices[0].message.content;
  return result;
}

function getModelKey(table: string) {
  switch (table) {
    case "dataset":
      return "model";
    case "results":
      return "provider";
    case "interactions_new":
      return "tone";
    default:
      return "model";
  }
}

function formatObject(table: string, object: object) {
  let result = {
    input: "",
    output: "",
    model: "",
  };
  switch (table) {
    case "results":
      result.input = object["prompt"];
      result.output = object["result"]["text"];
      result.model = object["provider"];
      break;
    case "interactions_new":
      let splittedModel = object["tone"].split("-");

      result.input = JSON.parse(object["input"])["content"];
      result.output = JSON.parse(object["output"])["text"];
      result.model = `${splittedModel[1]} ${
        splittedModel.length >= 2 ? splittedModel[2] : ""
      }`;
      break;
  }
  return result;
}
