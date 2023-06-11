import supabase from "./supabase.js";
import delay from "delay";
import fs from "fs";
import Papa from "papaparse";
import axios from "axios";

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
    formattedData.push(result);
  }
  await saveData(formattedData, id, "formatted");
  return formattedData;
}
let status = 0;

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
    let result = await cleanObject(data[i]);
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
    cleanedData.push(result);
    await saveData(cleanedData, id, "cleaning");
  }
  await saveData(cleanedData, id, "cleaned");
  return cleanedData;
}

async function cleanObject(object: any, retry = 0) {
  // remove model key
  delete object["model"];
  try {
    let response = await chatgpt([
      {
        role: "system",
        content:
          'The user is going to give you a chunk of a dataset containing an instruction, input and output. Remove any personal information such as nicknames, names etc. Clean the chunk so it is viable for training a LLM. In case the input/output says to continue the previous response, JUST RETURN {"reason":"conversational"}. In case the input or ouput makes reference to previous messages, JUST RETURN {"reason":"conversational"}. In case the input or output makes reference to an attachment or image, JUST RETURN {"reason":"images"}. In case the inpput is irrelevant or not good for LLM training, JUST RETURN {"reason":"irrelevant"}. DO NOT ADD EXPLANATIONS. JUST ANSWER WITH THE CLEANED DATA',
      },
      {
        role: "user",
        content: `${JSON.stringify(object)}`,
      },
    ]);
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
      max_tokens: 3000,
      messages: messages,
      temperature: 0.3,
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
