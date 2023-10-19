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
const cliProgress = require('cli-progress');
var cors = require('cors')

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
app.use(cors())
app.use(bodyparser.json());

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
    console.error("refresh token error",error);
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

app.get("/",async(req,res)=>{
  return res.json({"success":true});
})
app.post('/webhook',async(req,res)=>{
    let {data,file} = req.body;
    let file_uuid = data.uuid;
    let ext = data.original_filename.split('.')[data.original_filename.split(".").length-1];
    let file_name = file_uuid+"."+ext;
    db.run('INSERT INTO files (name,url,size,created_at) VALUES (?,?,?,?)', [file_name,file,data.size,Date.now()], (err) => {
      if (err) {
        console.error(err.message);
      } else {
        // console.log('File name inserted into the database:', file_name);
      }
    });
    res.json({success:true,data})
})


app.get('/alternate_link',async(req,res)=>{
 return res.sendFile(join(__dirname, '/loading_page.html'));
})

app.get('/testing_download',async(req,res)=>{
  return res.sendFile(join(__dirname, '/testing_download.html'));
})

app.get('/check_for_dropbox',async(req,res)=>{
  let {id} = req.query;
  let dbx = new Dropbox({ accessToken: await get_refresh_token()});
  let search_file = dbx.filesSearchV2({ "query":id ,
  "options": {
      "max_results":1
  }}).then(({result})=>{
    let matches = result?.matches?.[0];
    if(matches){
      return res.status(200).json({success:true});
    }
    return res.status(400).json({message:"id does not exist"});
  }).catch((err)=>{
    return res.status(400).json({message:"id does not exist"});
  });
})

app.get('/generate_share_link',async(req,res)=>{
  let {id} = req.query;
  let dbx = new Dropbox({ accessToken: await get_refresh_token()});
  let search_file = dbx.filesSearchV2({ "query":id ,
  "options": {
      "max_results":1
  }}).then(({result})=>{
    
    let matches = result?.matches?.[0];
    if(matches){
      let path = matches?.metadata?.metadata?.path_lower;
      if(path){
        dbx.sharingCreateSharedLinkWithSettings({
          path:path
        }).then((resp)=>{
          return res.json({id,link:resp?.result?.url});
        }).catch((err)=>{
            if(err?.error?.error?.shared_link_already_exists)
            {
              return res.json({id,link:err?.error?.error?.shared_link_already_exists?.metadata?.url});
            }
            return res.status(400).json({message:"id does not exist"});
        })
      }
    }
  }).catch((err)=>{
    return res.status(400).json({message:"id does not exist"});
  })
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
    db.all('SELECT id,name,url,size,created_at FROM files LIMIT 300', async (err, rows) => {
      if (err) {
        console.error(err.message);
        cron_running = false;
      } else {
          if(!rows.length){            
            cron_running = false;
            return;
          }
          console.log("Found ",rows.length," files for cronjob");
          console.log("Batch Started:",new Date());
          let dbx = new Dropbox({ accessToken: await get_refresh_token()});
          const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
          bar1.start(rows.length, 0);
          for(let i=0;i < rows.length ; i++){
            const row = rows[i];
            const file_name = row.name;
            const url = row.url;
            const size = row.size;
            if(size > 100000000){
              // console.log("big file----",file_name);
              await backup_big_files(row);
              console.log(`${file_name} Uploaded (${(i+1)}/${rows.length})`)
              bar1.update((i+1));
              continue
            }
            // console.log('small Name:', file_name,url,size);
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
                console.log(`${file_name} Uploaded (${(i+1)}/${rows.length})`)
                bar1.update((i+1));
                continue;
              }
            }
            let file_content = readFileSync(join(process.cwd(),'temp',file_name));
            let today = new Date();
            let path = today.getFullYear()+"/"+(today.getMonth()+1);
            await new Promise((resolve,rej)=>{
              dbx.filesUpload({path: "/"+path+"/"+file_name, contents: file_content}).then((res)=>{
                // console.log(file_name," File uploaded at",new Date())
                try{
                  unlinkSync(join(process.cwd(),'temp',file_name));
                  db.run('DELETE FROM files WHERE id = ?',[row.id],()=>{
                    // console.log(file_name," File deleted at",new Date())
                  })
                  // generate_share_link("/"+path+"/"+file_name)
                  resolve()
                }
                catch(err){
                  // console.log('err',err,file_name);
                  resolve()
                }
              }).catch((err)=>{
                // console.log("dropbox err",err);
                resolve()
              })
            })
            console.log(`${file_name} Uploaded (${(i+1)}/${rows.length})`)
            bar1.update((i+1));
          }
          bar1.stop();
          console.log("Batch Ended:",new Date());
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
  try{
    const file_name = row.name;
    const url = row.url;
    const size = row.size;
    const id = row.id;
    if(!existsSync(join(process.cwd(),'temp',file_name))){
      await file_download(file_name,url)
    }
    const fileContent = readFileSync(join(process.cwd(),'temp',file_name));
    const fileSize = fileContent.length;
    console.log(await upload_big_files(fileContent,fileSize,file_name,id));
  }
  catch(err){
    console.log("err",err);
  }
}
const upload_big_files = async (fileContent, fileSize, file_name, id) => {
  return new Promise(async (resolve, reject) => {
    try {
      let dbx = new Dropbox({ accessToken: await get_refresh_token() });
      let today = new Date();
      let path = today.getFullYear() + "/" + (today.getMonth() + 1);
      // Check if the file already exists in Dropbox
      const checkFileExists = async () => {
        try {
          const response = await dbx.filesGetMetadata({ path: "/" + path + "/" + file_name });
          if (response.result && response.result.id) {
            // console.log("File already exists in Dropbox");
            try{
              unlinkSync(join(process.cwd(), 'temp', file_name))
              new Promise((resolve, reject) => {
                db.run('DELETE FROM files WHERE id = ?', [id], () => {
                  console.log(file_name, "File deleted at", new Date());
                  resolve();
                });
              });
            }
            catch(err)
            {
              // console.log("something wrong happened");
            }
            
            resolve("File already exists in Dropbox");
          } else {
            return startUploadSession();
          }
        } catch (error) {
          // If the file doesn't exist, continue with the upload
          if (error && error?.status === 409) {
            return startUploadSession();
          } else {
            reject(error);
          }
        }
      };

      const startUploadSession = async () => {
        const response = await dbx.filesUploadSessionStart({ close: false, contents: '' });
        const sessionId = response.result.session_id;
        const chunkSize = 25 * 1024 * 1024;
        const numChunks = Math.ceil(fileSize / chunkSize);
        let offset = 0;

        const uploadChunk = async (chunkData, currentOffset) => {
          return dbx.filesUploadSessionAppendV2({
            cursor: {
              session_id: sessionId,
              offset: currentOffset,
            },
            close: false,
            contents: chunkData,
          });
        };

        const uploadChunks = async () => {
          let currentOffset = offset;

          for (let i = 0; i < numChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(fileSize, start + chunkSize);
            const chunkData = fileContent.slice(start, end);

            await uploadChunk(chunkData, currentOffset);
            currentOffset += chunkData.length; // Increment by the actual chunk size
            // console.log(`Uploaded chunk ${i + 1} of ${numChunks}`);
          }
          offset = currentOffset; // Update the offset for the finishUpload function
        };

        const finishUpload = () => {
          return dbx.filesUploadSessionFinish({
            cursor: {
              session_id: sessionId,
              offset,
            },
            commit: {
              path: "/" + path + "/" + file_name,
            },
            contents: '',
          });
        };

        uploadChunks()
          .then(() => finishUpload())
          .then(() => {
            // console.log(file_name, "File uploaded at", new Date());
            unlinkSync(join(process.cwd(), 'temp', file_name))
            return new Promise((resolve, reject) => {
              db.run('DELETE FROM files WHERE id = ?', [id], () => {
                // console.log(file_name, "File deleted at", new Date());
                resolve();
              });
            });
          })
          .then(() => {
            resolve('File upload and cleanup complete');
          })
          .catch((error) => {
            console.error('Error uploading file:', error);
            reject(error);
          });
      };
      // Check if the file exists and proceed with the upload
      checkFileExists();
    } catch (err) {
      console.error('Error uploading the file:', err);
      reject(err);
    }
  });
};

const generate_share_link = async (path) =>{
  let dbx = new Dropbox({ accessToken: await get_refresh_token() });
  dbx.sharingCreateSharedLinkWithSettings({
    path:path
  }).then((resp)=>{
    console.log("resp",resp);
  })
}

// cronExecution();
const job = new CronJob(
	'* * * * *',
	cronExecution,
	null,
	true,
);
job.start()