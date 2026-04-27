// index.js
const express = require('express');
const { spawn } = require('child_process');
const app = express();


app.use(express.json());

app.post('/api/chat', (req, res) => {
    const userPrompt = req.body.prompt;

    if (!userPrompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    // Spawn the Claude Code CLI in non-interactive mode
    // Outputting as JSON makes it easier for our API to parse
    const claudeProcess = spawn('claude', [
        '-p', userPrompt,
        '--output-format', 'json'
    ]);


    let outputData = '';
    let errorData = '';

    // Capture standard output
    claudeProcess.stdout.on('data', (data) => {
        outputData += data.toString();
    });


    // Capture error output (if any)
    claudeProcess.stderr.on('data', (data) => {
        errorData += data.toString();
    });


    // When the CLI finishes processing
    claudeProcess.on('close', (code) => {
        if (code !== 0) {
            return res.status(500).json({ error: 'CLI Error', details: errorData });
        }

        try {
            // Parse the JSON object returned by the CLI
            const parsedResult = JSON.parse(outputData);

 

            // Send it back to your web app
            res.json({ reply: parsedResult }); 
        } catch (err) {
            // Fallback in case the CLI returns plain text instead of strict JSON
            res.json({ reply: outputData.trim() });
        }
    });
});
 

const PORT = 3010;
app.listen(PORT, () => {
    console.log(`Claude Code hack-API running on http://localhost:${PORT}`);
});
