const ai = require('./ai');

async function test() {
    console.log('Sending message to AI...');
    const response = await ai.processUserInput('test_session', 'I need a phone number 3 p.m. sorry');
    console.log('--- AI RESPONSE ---');
    console.log(response);
    console.log('-------------------');
    
    const response2 = await ai.processUserInput('test_session', 'is that ok');
    console.log('--- AI RESPONSE 2 ---');
    console.log(response2);
    console.log('-------------------');
}

test();
