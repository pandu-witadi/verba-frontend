"use client"
import React, { useState, useEffect, useRef } from "react"
import PulseLoader from "react-spinners/PulseLoader"
import { IoMdSend } from "react-icons/io"
import { IoIosRefresh } from "react-icons/io"
import { AiFillRobot } from "react-icons/ai"

import { DocumentChunk } from "../Document/types"
import { Message, QueryPayload } from "./types"
import { getWebSocketApiHost } from "./util"
import ChatMessage from "./ChatMessage"
import { SettingsConfiguration } from "../Settings/types"

import StatusLabel from "./StatusLabel"

import ComponentStatus from "../Status/ComponentStatus"

import { RAGConfig } from "../RAG/types"
// import axios from 'axios'

// const llm_model = "llama3:latest"

interface ChatInterfaceComponentProps {
    settingConfig: SettingsConfiguration;
    APIHost: string | null;
    setChunks: (c: DocumentChunk[]) => void;
    setChunkTime: (t: number) => void;
    setCurrentPage: (p: any) => void;
    setContext: (c: string) => void;
    RAGConfig: RAGConfig | null;
    production: boolean;
}

interface AiModel {
    name: string
}

const ChatInterfaceComponent: React.FC<ChatInterfaceComponentProps> = ({
    APIHost,
    settingConfig,
    setChunks,
    setChunkTime,
    setCurrentPage,
    setContext,
    production,
    RAGConfig,
}) => {

    const [llm_model, set_llm_model] = useState<string|undefined>();

    // const options = [
    //     "HTML",
    //     "CSS",
    //     "JavaScript",
    //     "React",
    //     "Redux",
    // ];
    const onOptionChangeHandler = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const newText = event.target.value;
        set_llm_model(newText);
        console.log(
            "User Selected Value - ",
            newText
        )
    }

    const [options, setOptions] = useState<string[]>([])
    useEffect(() => {
        async function fetchData() {
            // Fetch data
            const resp = await fetch("http://117.54.250.85:5140/api/tags")
            let data = await resp.json()
            let results: string[] = ['Select model']
            // Store results in the results array
            data['models'].forEach((value: AiModel) => {
                results.push(value.name)
            });

            // Update the options state
            setOptions(results)
        }

        // Trigger the fetch
        fetchData().then(r => {})
    }, [])


    const [previewText, setPreviewText] = useState("")
    const lastMessageRef = useRef<null | HTMLDivElement>(null)

    const [socket, setSocket] = useState<WebSocket | null>(null)

    const [userInput, setUserInput] = useState("")
    const [messages, setMessages] = useState<Message[]>([])
    const isFetching = useRef<boolean>(false)
    const [fetchingStatus, setFetchingStatus] = useState<"DONE" | "CHUNKS" | "RESPONSE">("DONE")
    const [isFetchingSuggestion, setIsFetchingSuggestions] = useState(false)
    const [suggestions, setSuggestions] = useState<string[]>([])

    const [showNotification, setShowNotification] = useState(false)
    const [notificationText, setNotificationText] = useState("")
    const [notificationState, setNotificationState] = useState<"GOOD" | "BAD">("GOOD")

    const [isContext, setIsContext] = useState(false)
    const checkContextHandler = () => { setIsContext(!isContext) }


    const handleCopyToBillboard = (text: string) => {
        navigator.clipboard.writeText(text).then(
            function () {
                triggerNotification("Copied message")
            },
            function (err) {
              console.error("Unable to copy text: ", err)
            }
        )
    }

    const triggerNotification = (text: string, warning?: boolean) => {
        if (warning) {
            setNotificationState("BAD")
        } else {
            setNotificationState("GOOD")
        }

        if (showNotification) {
            setNotificationText(text)
            return;
        }

        setNotificationText(text)
        setShowNotification(true)

        // Hide the notification after 3 seconds
        setTimeout(() => {
            setShowNotification(false)
            setNotificationText("")
        }, 2000)
    }

    // Setup WebSocket and messages
    useEffect(() => {
        setMessages(getMessagesFromLocalStorage("VERBA_CONVERSATION"))
        setChunks(getChunksFromLocalStorage("VERBA_CHUNKS"))
        setContext(getContextFromLocalStorage("VERBA_CONTEXT"))

        const socketHost = getWebSocketApiHost()
        const localSocket = new WebSocket(socketHost)

        localSocket.onopen = () => {
            console.log("WebSocket connection opened to " + socketHost)
            triggerNotification("WebSocket Online")
        };

        localSocket.onmessage = (event) => {
            let data = null

            // if (!isFetching.current) {
            //     setPreviewText("")
            //     return;
            // }

            try {
                data = JSON.parse(event.data)
                // console.log(data)
            } catch (e) {
                // Exit early if data isn't valid JSON
                console.error("Received data is not valid JSON:", event.data)
                return
            }
            const newMessageContent = data.message;
            setPreviewText((prev) => prev + newMessageContent)

            if (data.finish_reason === "stop") {
                isFetching.current = false;
                setFetchingStatus("DONE")
                const full_text = data.full_text;
                if (data.cached) {
                    const distance = data.distance;
                    setMessages((prev) => [
                        ...prev,
                        {
                            role: "system",
                            content: full_text,
                            cached: true,
                            distance: distance,
                        },
                    ])
                } else {
                    setMessages((prev) => [
                        ...prev,
                        { role: "system", content: full_text },
                    ])
                }
                setPreviewText("")
            }
        }

        localSocket.onerror = (error) => {
            console.error("WebSocket Error:", error)
            triggerNotification("WebSocket Error: " + error, true)
            isFetching.current = false;
            setFetchingStatus("DONE")
        }

        localSocket.onclose = (event) => {
            if (event.wasClean) {
                console.log(
                    `WebSocket connection closed cleanly, code=${event.code}, reason=${event.reason}`
                )
            } else {
                console.error("WebSocket connection died")
            }
            triggerNotification("WebSocket Connection Offline", true)
            isFetching.current = false;
            setFetchingStatus("DONE")
        }

        setSocket(localSocket)

        return () => {
            if (localSocket.readyState !== WebSocket.CLOSED) {
                localSocket.close()
            }
        }
    }, [])

    // Scroll to latest message
    useEffect(() => {
        if (messages.length > 1) {
            saveMessagesToLocalStorage("VERBA_CONVERSATION", messages)
        }
        if (lastMessageRef.current) {
            const lastMessage = messages[messages.length - 1];
            lastMessageRef.current.scrollIntoView({ behavior: "smooth" })
        }
    }, [messages])

    const cancelGeneration = () => {
        triggerNotification("Canceled Generation", true)
        setPreviewText("")
        isFetching.current = false;
        setFetchingStatus("DONE")
    };

    const handleSuggestionClick = async (suggestion: string) => {
        // Update the userInput with the clicked suggestion
        setUserInput(suggestion)
        setSuggestions([])
    };

    const streamResponses = (query?: string, context?: string) => {
        if (socket?.readyState === WebSocket.OPEN) {
            const data = JSON.stringify({
                query: query,
                context: context,
                conversation: messages,
            })
            socket.send(data)
        } else {
            console.error("WebSocket is not open. ReadyState:", socket?.readyState)
        }
    };

    const handleKeyDown = (e: any) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault() // Prevent new line
            handleSendMessage(e) // Submit form
        }
    };

    const saveMessagesToLocalStorage = (key: string, value: Message[]) => {
        if (typeof window !== "undefined") {
            // Check if window is defined
            localStorage.setItem(key, JSON.stringify(value))
        }
    };

    const saveContextToLocalStorage = (key: string, value: string) => {
        if (typeof window !== "undefined") {
            // Check if window is defined
            localStorage.setItem(key, value)
        }
    };

    const getMessagesFromLocalStorage = (key: string) => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem(key)
            if (saved && JSON.parse(saved).length > 0) {
                return JSON.parse(saved)
            }
        }
        return [
            {
                role: "system",
                content: settingConfig.Customization.settings.intro_message.text,
            },
        ]; // Return a default value or null if not found
    };

    const removeMessagesFromLocalStorage = (key: string) => {
        if (typeof window !== "undefined") {
            localStorage.removeItem(key)
        }
    };

    const saveChunksToLocalStorage = (key: string, value: DocumentChunk[]) => {
        if (typeof window !== "undefined") {
            // Check if window is defined
            localStorage.setItem(key, JSON.stringify(value))
        }
    };

    const getChunksFromLocalStorage = (key: string) => {
        try {
            if (typeof window !== "undefined") {
                const saved = localStorage.getItem(key)
                if (saved && JSON.parse(saved).length > 0) {
                    return JSON.parse(saved)
                }
            }
        } catch (e) {
            console.error("Failed to load chunks from local storage:", e)
            return []; // Exit early if data isn't valid JSON
        }
        return []; // Return a default value or null if not found
    };

    const getContextFromLocalStorage = (key: string) => {
        try {
            if (typeof window !== "undefined") {
                const saved = localStorage.getItem(key)
                if (saved) {
                    return saved;
                }
            }
        } catch (e) {
            console.error("Failed to load context from local storage:", e)
            return "" // Exit early if data isn't valid JSON
        }
        return "" // Return a default value or null if not found
    };

    const removeChunksFromLocalStorage = (key: string) => {
        if (typeof window !== "undefined") {
            localStorage.removeItem(key)
        }
    };


    const handleSendMessage = async (e?: React.FormEvent) => {
        e?.preventDefault()

        setSuggestions([])

        if (APIHost === null) {
            triggerNotification("No connection to server")
            return;
        }

        if (isFetching.current)
            return

        const sendInput = userInput


        let messageTmp = [ ...messages ]

        // let messageData = {
        //     role: 'user',
        //     content: sendInput.trim()
        // }
        // let chat_json = {
        //     "model": llm_model,
        //     "messages": [ ...messages, messageData  ]
        // }

        if (sendInput.trim()) {
            setMessages((prev) => [...prev, { role: "user", content: sendInput }])
            setUserInput("")

            const textarea = document.getElementById("reset")
            if (textarea !== null) {
                // Check if the element is not null
                textarea.style.height = "" // Reset height
                textarea.style.width = "" // Reset width
            } else {
                console.error('The element with ID "target" was not found in the DOM.')
            }

            if ( !isContext ) {
                let chat_json = {
                    "model": llm_model,
                    "messages": [
                        ...messageTmp,
                        {
                            role: 'user',
                            content: sendInput.trim()
                        }
                    ]
                }
                socket?.send( JSON.stringify(chat_json) )
                isFetching.current = false
            } else {
                try {
                    // Start the API call
                    isFetching.current = true
                    setFetchingStatus("CHUNKS")

                    // Start both API calls in parallel
                    const response = await fetch(APIHost + "/api/query", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ query: sendInput }),
                    })

                    const data: QueryPayload = await response.json()
                    if (data) {
                        if (data.error !== "") {
                            // triggerNotification(data.error, true)
                            // isFetching.current = false;
                            // setFetchingStatus("DONE")


                            let chat_json = {
                                "model": llm_model,
                                "messages": [
                                    ...messageTmp,
                                    {
                                        role: 'user',
                                        content: sendInput.trim()
                                    }
                                ]
                            }
                            socket?.send( JSON.stringify(chat_json) )
                            isFetching.current = false

                        } else {
                //
                            setChunks(data.chunks)
                            saveChunksToLocalStorage("VERBA_CHUNKS", data.chunks)
                            // setSuggestions([])
                            setChunkTime(data.took)

                            if (data.context) {
                                console.log(data)
                                let messageData = {
                                    role: 'user',
                                    content: sendInput.trim()
                                }
                                let chat_json = {
                                    "model": llm_model,
                                    "messages": [
                                        ...messageTmp,
                                        {
                                            role: 'user',
                                            content: "With this provided context: " + data.context + "   Please answer this query: " + sendInput.trim()
                                        }
                                    ]
                                }
                                socket?.send( JSON.stringify(chat_json) )
                                isFetching.current = false
                                // setFetchingStatus("DONE")


                    //             streamResponses(sendInput, data.context)
                                setContext(data.context)
                                saveContextToLocalStorage("VERBA_CONTEXT", data.context)
                                setFetchingStatus("RESPONSE")
                            }
                        }
                    } else {
                        triggerNotification(
                            "Failed to fetch from API: No data received",
                            true
                        )
                        isFetching.current = false;
                        setFetchingStatus("DONE")
                    }
                } catch (error) {
                    console.error("Failed to fetch from API:", error)
                    triggerNotification("Failed to fetch from API: " + error, true)
                    isFetching.current = false;
                    setFetchingStatus("DONE")
                }
            }
        }
    };


    const fetchSuggestions = async (query: string) => {
        if (
            isFetchingSuggestion ||
            query === "" ||
            isFetching.current ||
            !settingConfig.Chat.settings.suggestion.checked
        ) {
            setSuggestions([])
            return;
        }

        try {
            setIsFetchingSuggestions(true)
                const response = await fetch(APIHost + "/api/suggestions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ query }),
            })

            const data = await response.json()

            if (data) {
                setSuggestions(data.suggestions)
                setIsFetchingSuggestions(false)
            } else {
                setIsFetchingSuggestions(false)
            }
        } catch (error) {
            console.error("Failed to fetch suggestions:", error)
            setIsFetchingSuggestions(false)
        }
    };

    const escapeRegExp = (string: string) => {
        return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // $& means the whole matched string
    };

    const renderBoldedSuggestion = (suggestion: string, userInput: string) => {
        const escapedUserInput = escapeRegExp(userInput)
        const parts = suggestion.split(new RegExp(`(${escapedUserInput})`, "gi"))
        return (
            <div className="flex flex-row gap-1">
                {parts.map((part, i) => (
                    <p key={i} className={ part.toLowerCase() === userInput.toLowerCase() ? "font-bold text-sm" : "" }>
                        {part}
                    </p>
                ))}
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2 h-full" >
            {/*Chat Messages*/}
            <div className="flex flex-col bg-bg-alt-verba rounded-lg shadow-lg text-text-verba gap-5 overflow-auto">
                <div className="flex gap-1 md:gap-2 items-center bg-gray-300 pl-5 pt-2 pb-2">
                    {RAGConfig && (
                        <div className="flex gap-2 items-center">
                            <ComponentStatus
                                disable={production}
                                component_name={
                                    RAGConfig ? RAGConfig["Generator"].selected : ""
                                }
                                Icon={AiFillRobot}
                                changeTo={"RAG"}
                                changePage={setCurrentPage}
                            />
                        </div>
                    )}
                    <div className="hidden sm:block md:h-[3vh] lg:h-[2vh] bg-text-alt-verba w-px mx-0 md:mx-1"></div>
                    <div className="form-control mr-2 bg-bg-verba pl-2 pr-2 pt-1 pb-1 rounded-lg">
                        <label className="label cursor-pointer">
                            <input type="checkbox" id="checkbox" checked={isContext} onChange={checkContextHandler} className="checkbox checkbox-primary"/>
                            <div className={'ml-2'}>{isContext ? "local context" : "no context"}</div>
                        </label>
                    </div>
                    <div className="flex items-center justify-center">
                        <select
                            onChange={onOptionChangeHandler}
                            className="select bg-bg-verba"
                        >
                            {options.map((option, index) => {
                                return (
                                    <option key={index}>
                                        {option}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                </div>

                <div className="flex flex-col pl-5 pr-5 ">
                    {messages.map((message, index) => (
                        <div ref={index === messages.length - 1 ? lastMessageRef : null} key={index}
                             className={`mb-4 ${message.role === "user" ? "text-right" : ""}`}>
                            <ChatMessage
                                message={message}
                                handleCopyToBillboard={handleCopyToBillboard}
                                 settingConfig={settingConfig}
                             />
                         </div>
                     ))}
                     {/* Render the preview message if available */}
                     {previewText && (
                         <ChatMessage
                            settingConfig={settingConfig}
                            message={{ role: "system", content: previewText, cached: false }}
                            handleCopyToBillboard={handleCopyToBillboard}
                        />
                    )}
                </div>

                {isFetching.current && (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center pl-4 mb-4 gap-3">
                            <PulseLoader
                                color={settingConfig.Customization.settings.text_color.color}
                                loading={true}
                                size={10}
                                speedMultiplier={0.75}
                            />
                            <p>
                                {fetchingStatus === "CHUNKS" && "Retrieving chunks"}
                                {fetchingStatus === "RESPONSE" && "Generating answer"}
                            </p>
                        </div>
                        <div className="items-center justify-center flex">
                            <button
                                onClick={cancelGeneration}
                                className="btn btn-sm text-sm bg-button-verba hover:bg-button-hover-verba text-text-verba"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/*Chat Input*/}
            <div className="flex flex-col bg-bg-alt-verba rounded-lg shadow-lg p-5 text-text-verba gap-5 min-h-[11vh]">
                <form className="flex justify-between w-full items-center gap-3" onSubmit={handleSendMessage}>
                    <textarea id={"reset"} rows={1} cols={10}
                        onKeyDown={handleKeyDown}
                        value={userInput}
                        onChange={(e) => {
                            setUserInput(e.target.value)
                            fetchSuggestions(e.target.value)
                        }}
                        className=" bg-bg-alt-verba textarea textarea-xs p-2 text-sm md:text-base w-full"
                        placeholder={`Ask ${settingConfig.Customization.settings.title.text} anything`}
                    ></textarea>
                    <button
                        type="submit"
                        className="btn btn-circle border-none shadow-none bg-bg-alt-verba hover:bg-secondary-verba"
                    >
                        <IoMdSend size={18} />
                    </button>
                    <div
                        className="tooltip text-text-verba"
                        data-tip="Reset Conversation"
                    >
                        <button
                              type="button"
                              onClick={() => {
                                removeMessagesFromLocalStorage("VERBA_CONVERSATION")
                                removeChunksFromLocalStorage("VERBA_CHUNKS")
                                removeChunksFromLocalStorage("VERBA_CONTEXT")
                                setChunks([])
                                setMessages([
                                  {
                                    role: "system",
                                    content:
                                      settingConfig.Customization.settings.intro_message.text,
                                  },
                                ])
                                setUserInput("")
                                setSuggestions([])
                                setContext("")
                              }}
                              className="btn btn-circle border-none shadow-none bg-bg-alt-verba hover:bg-secondary-verba"
                        >
                            <IoIosRefresh size={18} />
                        </button>
                    </div>
                </form>
                <div className='flex gap-1 md:gap-2 items-center p-2 bg-bg-verba'>
                    <StatusLabel
                        status={
                            APIHost !== null &&
                            socket !== null &&
                            socket.readyState === WebSocket.OPEN
                        }
                        true_text="Online"
                        false_text="Connecting..."
                    />
                    <StatusLabel
                        status={settingConfig.Chat.settings.caching.checked}
                        true_text="Caching"
                        false_text="No Caching"
                    />
                    <StatusLabel
                        status={settingConfig.Chat.settings.suggestion.checked}
                        true_text="Suggestions"
                        false_text="No Suggestions"
                    />
                </div>
            </div>

            <div className="flex flex-col gap-2">
                {suggestions.map((suggestion, index) => (
                    <button
                        key={index + suggestion}
                        className="btn sm:btn-sm md:btn-md border:none bg-button-verba hover:bg-button-hover-verba text-sm font-normal"
                        onClick={() => handleSuggestionClick(suggestion)}
                    >
                        {renderBoldedSuggestion(suggestion, userInput)}
                    </button>
                ))}
            </div>

            {/*Chat Notification*/}
            <div
                className={`animate-pop-in ${showNotification ? "opacity-100" : "opacity-0"} ${notificationState === "GOOD" ? "bg-secondary-verba" : "bg-warning-verba"} text-text-verba p-3 rounded text-sm transition-opacity`}
            >
                <p>{notificationText}</p>
            </div>
        </div>
    )
};

export default ChatInterfaceComponent;
