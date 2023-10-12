const express = require('express');
const bodyparser = require('body-parser');
var Dropbox = require('dropbox').Dropbox;
const axios = require('axios');
const {writeFileSync,readFileSync,unlinkSync} = require('fs');
const { join } = require('path');
const dotenv = require('dotenv');
dotenv.config();
const app = express();
app.use(bodyparser.json());

app.get('/',(req,res)=>{
    res.send("hello world");
})
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
var dbx = new Dropbox({ accessToken: process.env.DROPBOX_TOKEN});
app.post('/webhook',async(req,res)=>{
    let {data,file} = req.body;
    console.log("payload---->",data,'<----payload')
    const fileResponse = await axios({
        url: file,
        method: "GET",
        responseType: "arraybuffer",
    });
    let file_uuid = data.uuid;
    let ext = data.original_filename.split('.')[data.original_filename.split(".").length-1];
    let file_name = file_uuid+"."+ext;
    writeFileSync(join(process.cwd(),'temp',file_name),Buffer.from(fileResponse.data),{encoding:'binary'});
    let file_content = readFileSync(join(process.cwd(),'temp',file_name));

    dbx.filesUpload({path: "/"+file_name, contents: file_content}).then((res)=>{
        console.log("res",res)
        try{
          unlinkSync(join(process.cwd(),'temp',file_name));
        }
        catch(err){
          console.log('err',err);
        }
      }).catch((err)=>{
        console.log("dropbox err",err);
    })
    res.json({success:true,data})
})

app.listen(7000,()=>{
    console.log("server started");    
})