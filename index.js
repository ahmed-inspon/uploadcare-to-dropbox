const express = require('express');
const bodyparser = require('body-parser');
var Dropbox = require('dropbox').Dropbox;
const axios = require('axios');
const {writeFileSync,readFileSync,unlinkSync, existsSync} = require('fs');
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
    db.all('SELECT id,name,url,size,created_at FROM files LIMIT 100', async (err, rows) => {
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
              console.log("big file----",file_name);
              continue;
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
const job = new CronJob(
	'*/2 * * * *',
	cronExecution,
	null,
	true,
);
job.start()