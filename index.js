const express = require('express');
const bodyparser = require('body-parser');
var Dropbox = require('dropbox').Dropbox;
const axios = require('axios');
const {writeFileSync,createReadStream,createWriteStream,readFileSync,unlinkSync, existsSync} = require('fs');
const { join } = require('path');
const dotenv = require('dotenv');
const FormData = require('form-data');
const sqlite3 = require('sqlite3').verbose();
const {CronJob} = require('cron');
let db = new sqlite3.Database('./file.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to database.');
});
db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, name TEXT ,size TEXT,url TEXT, created_at TEXT)");
});



dotenv.config();
const app = express();
app.use(bodyparser.json());

app.get('/',(req,res)=>{
    res.send("hello world");
})

const get_refresh_token = async ()=>{
  let data = new FormData();
  data.append('client_id', process.env.CLIENT_ID);
  data.append('client_secret', process.env.CLIENT_SECRET);
  data.append('refresh_token', process.env.REFRESH_TOKEN);
  data.append('grant_type', 'refresh_token');

  let config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://api.dropbox.com/oauth2/token',
    headers: { 
      'Cookie': 'locale=en; t=96qUVQ_4RiZfwhmL0qvzOvgD', 
      ...data.getHeaders()
    },
    data : data
  };

  try {
    const response = await axios.request(config);
    let {data} = response;
    if(data && data.access_token){
      return data.access_token
    }
  }
  catch (error) {
    console.log(error);
    return null
  }
}

let sample = {
    "data": {
      "content_info": { mime: [Object], image: [Object] },
      "uuid": "d9b26444-3cf4-408d-9211-be299f41dccc",
      "is_image": true,
      "is_ready": true,
      "metadata": {},
      "appdata": {},
      "mime_type": "image/jpeg",
      "original_filename": "inbound8868601096635665276.jpg",
      "original_file_url": "https://ucarecdn.com/d9b26444-3cf4-408d-9211-be299f41dccc/inbound8868601096635665276.jpg",
      "datetime_removed": null,
      "size": 12278610,
      "datetime_stored": null,
      "url": "https://api.uploadcare.com/files/d9b26444-3cf4-408d-9211-be299f41dccc/",
      "datetime_uploaded": "2023-10-12T09:25:45.598409Z",
      "variations": null
    },
    "file": "https://ucarecdn.com/d9b26444-3cf4-408d-9211-be299f41dccc/inbound8868601096635665276.jpg"
  }
app.post('/webhook',async(req,res)=>{
    let {data,file} = req.body;
    let file_uuid = data.uuid;
    let ext = data.original_filename.split('.')[data.original_filename.split(".").length-1];
    let file_name = file_uuid+"."+ext;
    db.run('INSERT INTO files (name,url,size,created_at) VALUES (?,?,?,?)', [file_name,file,data.size,Date.now()], (err) => {
      if (err) {
        console.error(err.message);
      } else {
        console.log('File name inserted into the database:', file_name);
      }
    });
    res.json({success:true,data})
})

app.listen(7000,()=>{
    console.log("server started");    
})
let cron_running = false;
const cronExecution = () =>{
  try {
    if(cron_running)
    {
      console.warn('existing cron is not completed');
      return;
    }
  
    cron_running = true;
    db.all('SELECT id,name,url,size,created_at FROM files LIMIT 200', async (err, rows) => {
      if (err) {
        console.error(err.message);
        cron_running = false;
      } else {
          if(!rows.length){            
            cron_running = false;
            return;
          }
          console.log("Found ",rows.length," files for cronjob");
          let dbx = new Dropbox({ accessToken: await get_refresh_token()});
          for(let i=0;i < rows.length ; i++){
            const row = rows[i];
            const file_name = row.name;
            const url = row.url;
            const size = row.size;
            if(size > 100000000){
              await backup_big_files(row);
              console.log("big file----",file_name);
              continue;
            }
            else{
              continue
            }
            console.log('File Name:', file_name,url,size);
            if(!existsSync(join(process.cwd(),'temp',file_name))){
              try {
                const fileResponse = await axios({
                  url: url,
                  method: "GET",
                  responseType: "arraybuffer",
                });
                writeFileSync(join(process.cwd(),'temp',file_name),Buffer.from(fileResponse.data),{encoding:'binary'});
              } catch (error) {
                console.error("file does not exist")
                continue;
              }
            }
            let file_content = readFileSync(join(process.cwd(),'temp',file_name));
            let today = new Date();
            let path = today.getFullYear()+"/"+(today.getMonth()+1);
            await new Promise((resolve,rej)=>{
              dbx.filesUpload({path: "/"+path+"/"+file_name, contents: file_content}).then((res)=>{
                console.log(file_name," File uploaded at",new Date())
                try{
                  unlinkSync(join(process.cwd(),'temp',file_name));
                  db.run('DELETE FROM files WHERE id = ?',[row.id],()=>{
                    console.log(file_name," File deleted at",new Date())
                  })
                  resolve()
                }
                catch(err){
                  console.log('err',err,file_name);
                  resolve()
                }
              }).catch((err)=>{
                console.log("dropbox err",err);
                resolve()
              })
            })
          }
          cron_running = false;
      }
    });
  } catch (error) {
    console.error('error happened in cron')
    cron_running = false;
  }

}

const file_download = async (file_name, url) => {
  const filePath = join(process.cwd(), 'temp', file_name);
  
  try {
    const response = await axios.get(url, { responseType: 'stream' });

    const writer = createWriteStream(filePath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('Error downloading file:', error);
    if (error.response && error.response.status === 404) {
      console.log('Fetching through uploadly------------------------');
      try {
        const response = await axios.get(`https://uploadly-files.com/${file_name}`, { responseType: 'stream' });

        const writer = createWriteStream(filePath);

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
      } catch (error) {
        if (error.response && error.response.status === 400) {
          console.error('Big file error:', error.response.data);
        } else {
          console.error('Error fetching through uploadly:', error);
        }
      }
    }
  }
};

const backup_big_files = async(row) =>{
  const file_name = row.name;
  const url = row.url;
  const size = row.size;
  const id = row.id;
  if(!existsSync(join(process.cwd(),'temp',file_name))){
    await file_download(file_name,url)
  }
  // const fileContent = readFileSync(join(process.cwd(),'temp',file_name));
  // const fileSize = fileContent.length;
  console.log(await upload_big_files(file_name,id),file_name);
}

function upload_big_files(file_name, id) {
  return new Promise(async (resolve, reject) => {
    const chunkSize = 4 * 1024 * 1024; // 4MB chunks (adjust as needed)
    const localFilePath = join(process.cwd(),'temp',file_name)
    const fileStream = createReadStream(localFilePath);
    let offset = 0;
    let sessionId;
    let dbx = new Dropbox({ accessToken: await get_refresh_token()});
    // Function to upload a chunk
    async function uploadChunk(chunk) {
      try {
        await dbx.filesUploadSessionAppendV2({
          cursor: { session_id: sessionId, offset: offset },
          close: false,
          contents: chunk,
        });
        offset += chunk.length;
      } catch (error) {
        reject(error);
      }
    }

    // Function to finish the upload session
    async function finishUpload(file_name) {
      try {

        let today = new Date();
        let path = today.getFullYear()+"/"+(today.getMonth()+1);    
        await dbx.filesUploadSessionFinish({
          cursor: {
            session_id: sessionId,
            offset: offset,
          },
          commit: { path: "/"+path+"/"+file_name },
        });
        resolve('File upload complete');
      } catch (error) {
        reject(error);
      }
    }

    fileStream.on('data', (chunk) => {
      if (!sessionId) {
        // Start a new upload session
        dbx.filesUploadSessionStart({ contents: chunk })
          .then((response) => {
            sessionId = response.session_id;
            offset += chunk.length;
            uploadChunk(chunk);
          })
          .catch((error) => {
            reject(error);
          });
      } else {
        // Continue the upload session
        uploadChunk(chunk);
      }
    });

    fileStream.on('end', () => {
      // Finish the upload session when the file is fully uploaded
      finishUpload(file_name);
    });
  });
}

// const upload_big_files = async (fileContent,fileSize,file_name,id) =>{
//   let dbx = new Dropbox({ accessToken: await get_refresh_token()});
//   dbx.filesUploadSessionStart({ close: false, contents: fileContent })
//   .then((response) => {
//     const sessionId = response.result.session_id;

//     // Define the chunk size (4 MB is a reasonable chunk size)
//     const chunkSize = 4 * 1024 * 1024;

//     // Calculate the number of chunks
//     const numChunks = Math.ceil(fileSize / chunkSize);

//     let offset = 0;

//     // Function to upload a chunk
//     const uploadChunk = async (chunkData) => {
//       return dbx.filesUploadSessionAppendV2({
//         cursor: {
//           session_id: sessionId,
//           offset,
//         },
//         close: false,
//         contents: chunkData,
//       });
//     };

//     // Upload each chunk
//     const uploadChunks = async () => {
//       for (let i = 0; i < numChunks; i++) {
//         const start = i * chunkSize;
//         const end = Math.min(fileSize, start + chunkSize);
//         const chunkData = fileContent.slice(start, end);

//         await uploadChunk(chunkData);

//         offset += chunkSize;

//         console.log(`Uploaded chunk ${i + 1} of ${numChunks}`);
//       }
//     };

//     // Finish the upload session
//     let today = new Date();
//     let path = today.getFullYear()+"/"+(today.getMonth()+1);
//     const finishUpload = () => {
//       return dbx.filesUploadSessionFinish({
//         cursor: {
//           session_id: sessionId,
//           offset,
//         },
//         commit: {
//           path: "/"+path+"/"+file_name,
//         },
//         contents: '',
//       });
//     };

//     // Upload the chunks and finish the session
//     uploadChunks()
//       .then(() => finishUpload())
//       .then(() => {
//         console.log(file_name," File uploaded at",new Date())
//         try{
//           unlinkSync(join(process.cwd(),'temp',file_name));
//           db.run('DELETE FROM files WHERE id = ?',[id],()=>{
//             console.log(file_name," File deleted at",new Date())
//           })
//         }
//         catch(err){
//           console.log('err',err,file_name);
//         }
//       })
//       .catch((error) => {
//         console.error('Error uploading file:', error);
//       });
//   })
//   .catch((error) => {
//     console.error('Error starting the upload session:', error);
//   });
// }
cronExecution();
// const job = new CronJob(
// 	'*/5 * * * *',
// 	cronExecution,
// 	null,
// 	true,
// );
// job.start()