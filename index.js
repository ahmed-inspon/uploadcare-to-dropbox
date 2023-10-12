const express = require('express');
const bodyparser = require('body-parser');

const app = express();
app.use(bodyparser.json());

app.get('/',(req,res)=>{
    res.send("hello world");
})

app.post('/webhook',(req,res)=>{
    let payload = req.body;
    console.log("payload---->",payload,'<----payload')
    res.json({success:true,payload})
})

app.listen(7000,()=>{
    console.log("server started");    
})